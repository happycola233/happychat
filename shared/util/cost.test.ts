import { describe, expect, it } from 'vitest'
import { costUsd } from './cost'

describe('costUsd', () => {
  it('returns 0 when pricing is missing', () => {
    const t = { inputTokens: 1000, cachedTokens: 0, outputTokens: 1000, imageTokens: 0 }
    expect(costUsd(t, null)).toBe(0)
    expect(costUsd(t, undefined)).toBe(0)
    expect(costUsd(t, {})).toBe(0)
  })

  it('prices uncached input, cached input and output per 1M tokens', () => {
    const cost = costUsd(
      { inputTokens: 1_000_000, cachedTokens: 200_000, outputTokens: 500_000, imageTokens: 0 },
      { input: 2.5, cachedInput: 0.25, output: 10 },
    )
    // uncached 800k*2.5/1e6=2.0 + cached 200k*0.25/1e6=0.05 + output 500k*10/1e6=5.0
    expect(cost).toBeCloseTo(7.05, 6)
  })

  it('falls back cached tokens to input price when cachedInput is unset', () => {
    const cost = costUsd(
      { inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 0, imageTokens: 0 },
      { input: 3 },
    )
    expect(cost).toBeCloseTo(3, 6)
  })

  it('prices image tokens separately', () => {
    const cost = costUsd(
      { inputTokens: 0, cachedTokens: 0, outputTokens: 0, imageTokens: 1_000_000 },
      { image: 40 },
    )
    expect(cost).toBe(40)
  })

  it('ignores token kinds without a configured price', () => {
    const cost = costUsd(
      { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 1_000_000, imageTokens: 0 },
      { output: 10 },
    )
    // input has no price → only output counts
    expect(cost).toBeCloseTo(10, 6)
  })
})
