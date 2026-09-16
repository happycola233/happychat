import { describe, expect, it } from 'vitest'
import { DEFAULT_RETRY_POLICY, retryDelayMs, retryPolicySchema } from './retry'

describe('重试策略', () => {
  it('默认关闭，间隔递增并在上限停住', () => {
    expect(DEFAULT_RETRY_POLICY.enabled).toBe(false)
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(DEFAULT_RETRY_POLICY, n, 0))).toEqual([
      5000, 10000, 20000, 40000, 60000, 60000,
    ])
    expect(retryDelayMs(DEFAULT_RETRY_POLICY, 1, 1)).toBe(6000)
  })
  it('拒绝永久错误状态与互相矛盾的等待参数', () => {
    expect(
      retryPolicySchema.safeParse({ ...DEFAULT_RETRY_POLICY, retryStatusCodes: [401] }).success,
    ).toBe(false)
    expect(
      retryPolicySchema.safeParse({ ...DEFAULT_RETRY_POLICY, maxDelaySeconds: 2 }).success,
    ).toBe(false)
    expect(
      retryPolicySchema.safeParse({ ...DEFAULT_RETRY_POLICY, maxElapsedSeconds: 10 }).success,
    ).toBe(false)
    expect(retryPolicySchema.safeParse(DEFAULT_RETRY_POLICY).success).toBe(true)
  })
})
