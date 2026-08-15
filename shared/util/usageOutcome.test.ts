import { describe, expect, it } from 'vitest'
import { resolveUsageResult } from './usageOutcome'

describe('resolveUsageResult', () => {
  it.each([
    ['completed', null, 'completed'],
    ['incomplete', 'max_output_tokens', 'incomplete'],
    ['failed', 'refusal', 'refused'],
    ['failed', 'content_filter', 'filtered'],
    ['failed', 'rate_limit_error', 'failed'],
    ['canceled', 'user_cancelled', 'canceled'],
    ['interrupted', 'server_restart', 'interrupted'],
  ] as const)('%s / %s -> %s', (outcome, reason, expected) => {
    expect(resolveUsageResult(outcome, reason)).toBe(expected)
  })
})
