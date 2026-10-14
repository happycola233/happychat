import { eq } from 'drizzle-orm'
import type { ExchangeRateSnapshot } from '@shared/types/domain'
import { HTTPException } from 'hono/http-exception'
import { db } from '../db/client'
import { exchangeRates } from '../db/schema'

const RATE_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=USD'
const CACHE_MS = 5 * 60_000
let inFlight: Promise<ExchangeRateSnapshot | null> | null = null
let retryAt = 0

export function storedExchangeRate(): ExchangeRateSnapshot | undefined {
  const row = db.select().from(exchangeRates).where(eq(exchangeRates.id, 1)).get()
  return row ? { usdToCny: row.usdToCny, fetchedAt: row.fetchedAt.getTime() } : undefined
}

export function legacyExchangeRate(): ExchangeRateSnapshot | undefined {
  const row = db.select().from(exchangeRates).where(eq(exchangeRates.id, 1)).get()
  return row ? { usdToCny: row.legacyRate, fetchedAt: row.legacyAt.getTime() } : undefined
}

/** 汇率接口是系统边界；失败沿用已持久化的最近成功值。 */
export async function getExchangeRate(): Promise<ExchangeRateSnapshot | null> {
  const previous = storedExchangeRate()
  if (previous && Date.now() - previous.fetchedAt < CACHE_MS) return previous
  if (Date.now() < retryAt) return previous ?? null
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const response = await fetch(RATE_URL, {
        signal: AbortSignal.timeout(4_000),
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as {
        data?: { currency?: unknown; rates?: { CNY?: unknown } }
      }
      const rate = Number(body.data?.rates?.CNY)
      if (body.data?.currency !== 'USD' || !Number.isFinite(rate) || rate <= 0)
        throw new Error('响应中缺少有效的 USD/CNY 汇率')
      const fetchedAt = new Date()
      db.insert(exchangeRates)
        .values({ id: 1, usdToCny: rate, fetchedAt, legacyRate: rate, legacyAt: fetchedAt })
        .onConflictDoUpdate({ target: exchangeRates.id, set: { usdToCny: rate, fetchedAt } })
        .run()
      retryAt = 0
      return { usdToCny: rate, fetchedAt: fetchedAt.getTime() }
    } catch (error) {
      retryAt = Date.now() + 60_000
      console.warn('获取 USD/CNY 汇率失败，沿用最近成功值：', error)
      return previous ?? null
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

export async function requireExchangeRate(): Promise<ExchangeRateSnapshot> {
  const rate = await getExchangeRate()
  if (!rate) throw new HTTPException(503, { message: '暂时无法取得汇率，请稍后重试。' })
  return rate
}

export function resetExchangeRateCacheForTests(): void {
  inFlight = null
  retryAt = 0
}
