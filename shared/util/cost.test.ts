import { describe, expect, it } from 'vitest'
import { calculateRequestCost, costUsd, createRequestPricingSnapshot } from './cost'

describe('costUsd', () => {
  it('returns 0 when pricing is missing', () => {
    const t = {
      inputTokens: 1000,
      cacheWriteTokens: 0,
      cachedTokens: 0,
      outputTokens: 1000,
      imageTokens: 0,
    }
    expect(costUsd(t, null)).toBe(0)
    expect(costUsd(t, undefined)).toBe(0)
    expect(costUsd(t, {})).toBe(0)
  })

  it('prices ordinary input, cache writes, cache reads and output per 1M tokens', () => {
    const cost = costUsd(
      {
        inputTokens: 1_000_000,
        cacheWriteTokens: 300_000,
        cachedTokens: 200_000,
        outputTokens: 500_000,
        imageTokens: 0,
      },
      { input: 2.5, cacheWriteInput: 3.125, cachedInput: 0.25, output: 10 },
    )
    // 普通输入 500k*2.5 + 写入 300k*3.125 + 读取 200k*0.25 + 输出 500k*10。
    expect(cost).toBeCloseTo(7.2375, 6)
  })

  it('falls back cached tokens to input price when cachedInput is unset', () => {
    const cost = costUsd(
      {
        inputTokens: 1_000_000,
        cacheWriteTokens: 0,
        cachedTokens: 1_000_000,
        outputTokens: 0,
        imageTokens: 0,
      },
      { input: 3 },
    )
    expect(cost).toBeCloseTo(3, 6)
  })

  it('preserves the input-price fallback for historical snapshots without cacheWriteInput', () => {
    const cost = costUsd(
      {
        inputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        cachedTokens: 0,
        outputTokens: 0,
        imageTokens: 0,
      },
      { input: 3 },
    )
    expect(cost).toBeCloseTo(3, 6)
  })

  it('prices image tokens separately', () => {
    const cost = costUsd(
      {
        inputTokens: 0,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        imageTokens: 1_000_000,
      },
      { image: 40 },
    )
    expect(cost).toBe(40)
  })

  it('ignores token kinds without a configured price', () => {
    const cost = costUsd(
      {
        inputTokens: 1_000_000,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        outputTokens: 1_000_000,
        imageTokens: 0,
      },
      { output: 10 },
    )
    // input has no price → only output counts
    expect(cost).toBeCloseTo(10, 6)
  })

  it('does not double-charge malformed cache details beyond total input', () => {
    const cost = costUsd(
      {
        inputTokens: 1_000_000,
        cacheWriteTokens: 800_000,
        cachedTokens: 800_000,
        outputTokens: 0,
        imageTokens: 0,
      },
      { input: 2, cacheWriteInput: 4, cachedInput: 1 },
    )
    // 读取优先占 800k，写入裁剪到剩余 200k，总输入只计费一次。
    expect(cost).toBeCloseTo(1.6, 6)
  })
})

describe.each(['responses', 'chat', 'anthropic'] as const)('%s request pricing', (kind) => {
  it.each([
    { cacheWriteInput: undefined, expected: 3.1 },
    { cacheWriteInput: 0, expected: 3.1 },
    { cacheWriteInput: 4, expected: 4.3 },
  ])(
    'charges cache writes at $cacheWriteInput per million tokens',
    ({ cacheWriteInput, expected }) => {
      const usage = {
        inputTokens: 1_000_000,
        cacheWriteTokens: 300_000,
        cachedTokens: 200_000,
        outputTokens: 500_000,
        imageTokens: 0,
      }
      const pricing = { input: 2, output: 4, cachedInput: 0.5, cacheWriteInput }
      const cost = calculateRequestCost(usage, pricing, kind, [])
      // 普通输入 500k、缓存读取 200k 与输出 500k 共 3.1 USD；写入留空或填 0 不加价。
      expect(cost.chatUsd).toBeCloseTo(expected, 6)
      expect(cost.totalUsd).toBeCloseTo(expected, 6)

      // 序列化后的新快照仍保留默认值，统计回算不会再沿用普通输入价格。
      const snapshot = JSON.parse(JSON.stringify(createRequestPricingSnapshot(pricing, kind)))
      expect(costUsd(usage, snapshot)).toBeCloseTo(expected, 6)
      expect(pricing.cacheWriteInput).toBe(cacheWriteInput)
    },
  )
})
