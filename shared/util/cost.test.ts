import { describe, expect, it } from 'vitest'
import { costUsd } from './cost'

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

  it('falls back cache-write tokens to input price when cacheWriteInput is unset', () => {
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
