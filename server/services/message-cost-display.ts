import type { AppConfigDTO, MessageCostDisplayDTO } from '@shared/types/api'

const USD_CNY_RATE_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=USD'
const RATE_CACHE_TTL_MS = 5 * 60 * 1000
const FAILED_REQUEST_RETRY_MS = 60 * 1000
const REQUEST_TIMEOUT_MS = 4_000

interface CachedRate {
  rate: number
  freshUntil: number
}

let cachedRate: CachedRate | null = null
let retryAfter = 0
let inFlightRequest: Promise<number | null> | null = null

function parseUsdToCnyRate(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  if ((data as { currency?: unknown }).currency !== 'USD') return null
  const rates = (data as { rates?: unknown }).rates
  if (!rates || typeof rates !== 'object') return null
  const rate = Number((rates as Record<string, unknown>).CNY)
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

async function fetchUsdToCnyRate(): Promise<number> {
  const response = await fetch(USD_CNY_RATE_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const rate = parseUsdToCnyRate(await response.json())
  if (rate === null) throw new Error('响应中缺少有效的 USD/CNY 汇率')
  return rate
}

/**
 * 获取当前 USD→CNY 汇率。成功结果仅缓存在当前服务进程内；失败时优先沿用内存中的
 * 最近成功值，冷启动且上游不可用时返回 null，由聊天界面回退展示原始 USD。
 */
export async function getUsdToCnyRate(): Promise<number | null> {
  const now = Date.now()
  if (cachedRate && cachedRate.freshUntil > now) return cachedRate.rate
  if (retryAfter > now) return cachedRate?.rate ?? null
  if (inFlightRequest) return inFlightRequest

  inFlightRequest = fetchUsdToCnyRate()
    .then((rate) => {
      cachedRate = { rate, freshUntil: Date.now() + RATE_CACHE_TTL_MS }
      retryAfter = 0
      return rate
    })
    .catch((error: unknown) => {
      retryAfter = Date.now() + FAILED_REQUEST_RETRY_MS
      console.warn(
        `获取 USD/CNY 汇率失败，${cachedRate ? '沿用最近成功值' : '聊天成本回退为 USD'}：`,
        error,
      )
      return cachedRate?.rate ?? null
    })
    .finally(() => {
      inFlightRequest = null
    })

  return inFlightRequest
}

/** 解析聊天消息用量行的展示上下文；不会换算或写回数据库中的 costUsd。 */
export async function getMessageCostDisplay(
  config: Pick<AppConfigDTO, 'showCost' | 'costCurrency'>,
): Promise<MessageCostDisplayDTO> {
  if (!config.showCost || config.costCurrency === 'USD') {
    return { currency: config.costCurrency, usdToCnyRate: null }
  }
  return { currency: 'CNY', usdToCnyRate: await getUsdToCnyRate() }
}

/** 仅供单元测试隔离模块级内存缓存。 */
export function resetMessageCostDisplayCacheForTests(): void {
  cachedRate = null
  retryAfter = 0
  inFlightRequest = null
}
