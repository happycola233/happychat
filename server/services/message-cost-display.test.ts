import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getMessageCostDisplay,
  getUsdToCnyRate,
  resetMessageCostDisplayCacheForTests,
} from './message-cost-display'

afterEach(() => {
  resetMessageCostDisplayCacheForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('聊天消息成本汇率', () => {
  it('从 Coinbase 读取 USD/CNY 汇率并在内存中复用', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ data: { currency: 'USD', rates: { CNY: '7.123456' } } }),
        { status: 200 },
      ),
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

    await expect(
      getMessageCostDisplay({ showCost: true, costCurrency: 'USD' }),
    ).resolves.toEqual({ currency: 'USD', usdToCnyRate: null })
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(
      getMessageCostDisplay({ showCost: true, costCurrency: 'CNY' }),
    ).resolves.toEqual({ currency: 'CNY', usdToCnyRate: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
