import { describe, expect, it } from 'vitest'
import { DEFAULT_RETRY_POLICY, retryDelayMs, retryPolicySchema } from './retry'

describe('重试策略', () => {
  it('旧配置自动补齐流式重试设置', () => {
    const legacy = { ...DEFAULT_RETRY_POLICY } as Partial<typeof DEFAULT_RETRY_POLICY>
    delete legacy.retryAfterOutput
    delete legacy.streamIdleTimeoutSeconds
    expect(retryPolicySchema.parse(legacy)).toMatchObject({
      retryAfterOutput: true,
      streamIdleTimeoutSeconds: 300,
    })
  })
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

  it.each([
    [1, 1],
    [600, 9000],
    [3600, 86400],
    [3_000_000, 6_000_000],
  ])('接受单次等待 %i 秒、总等待 %i 秒', (attemptTimeoutSeconds, maxElapsedSeconds) => {
    expect(
      retryPolicySchema.safeParse({
        ...DEFAULT_RETRY_POLICY,
        attemptTimeoutSeconds,
        maxElapsedSeconds,
      }).success,
    ).toBe(true)
  })

  it.each(['attemptTimeoutSeconds', 'maxElapsedSeconds'] as const)(
    '%s 仅接受正整数秒数，非法输入显示中文提示',
    (field) => {
      for (const value of [0, -1, 1.5, NaN, Infinity, '9000']) {
        const result = retryPolicySchema.safeParse({ ...DEFAULT_RETRY_POLICY, [field]: value })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toMatch(/正整数秒数|必须大于 0 秒/)
        }
      }
    },
  )
})
