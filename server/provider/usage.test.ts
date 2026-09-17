import { describe, expect, it } from 'vitest'
import { addMessageUsage } from './usage'

describe('upstream input usage for context suggestions', () => {
  it('keeps billing cumulative but remembers only the latest input across retries and continuations', () => {
    const usage = {
      inputTokens: 80000,
      cacheWriteTokens: 5000,
      cachedTokens: 50000,
      outputTokens: 1000,
      reasoningTokens: 200,
      totalTokens: 81000,
    }
    const continuation = addMessageUsage(usage, { ...usage, inputTokens: 81000 })
    const retry = addMessageUsage(usage, continuation)
    expect(retry.inputTokens).toBe(241000)
    expect(retry.lastInputTokens).toBe(81000)
    expect(retry.cachedTokens).toBe(150000)
  })
})
