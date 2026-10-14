import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
let getMessageCostDisplay: typeof import('./message-cost-display').getMessageCostDisplay
let getUsdToCnyRate: typeof import('./message-cost-display').getUsdToCnyRate
let resetMessageCostDisplayCacheForTests: typeof import('./message-cost-display').resetMessageCostDisplayCacheForTests
let client: typeof import('../db/client')
let tables: typeof import('../db/schema')
let tmpDir: string
beforeAll(async () => {
  mkdirSync('.tmp', { recursive: true })
  tmpDir = mkdtempSync(join(process.cwd(), '.tmp', 'exchange-rate-'))
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'test.db')
  process.env.NODE_ENV = 'test'
  vi.resetModules()
  client = await import('../db/client')
  tables = await import('../db/schema')
  const migration = await import('../db/migrate')
  migration.runMigrations()
  ;({ getMessageCostDisplay, getUsdToCnyRate, resetMessageCostDisplayCacheForTests } =
    await import('./message-cost-display'))
})
afterAll(() => {
  client.sqlite.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

afterEach(() => {
  client.db.delete(tables.exchangeRates).run()
  resetMessageCostDisplayCacheForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('聊天消息成本汇率', () => {
  it('从 Coinbase 读取 USD/CNY 汇率并在内存中复用', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { currency: 'USD', rates: { CNY: '7.123456' } } }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getUsdToCnyRate()).resolves.toBe(7.123456)
    await expect(getUsdToCnyRate()).resolves.toBe(7.123456)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('USD 展示不请求汇率，CNY 上游不可用时返回空汇率供前端回退', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(getMessageCostDisplay({ showCost: true, costCurrency: 'USD' })).resolves.toEqual({
      currency: 'USD',
      usdToCnyRate: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(getMessageCostDisplay({ showCost: true, costCurrency: 'CNY' })).resolves.toEqual({
      currency: 'CNY',
      usdToCnyRate: null,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
