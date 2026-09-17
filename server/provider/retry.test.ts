import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RETRY_POLICY } from '@shared/schemas/retry'
import { retryAfterMs, retryDecision, scheduleLongTimeout, waitForRetry } from './retry'

afterEach(() => vi.useRealTimers())
describe('统一重试策略与长计时', () => {
  it('524 使用独立开关，仍遵守永久错误、次数和时间预算', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, enabled: true }
    const failure = { status: 524, type: 'server_error', code: 'internal_server_error' }
    const deadline = Date.now() + 900000
    expect(retryDecision(policy, failure, 1, deadline, 'connecting').stopReason).toBeNull()
    expect(
      retryDecision(
        { ...policy, retryStatusCodes: policy.retryStatusCodes.filter((status) => status !== 524) },
        failure,
        1,
        deadline,
        'connecting',
      ).stopReason,
    ).toBe('not_retryable')
    expect(
      retryDecision(policy, { ...failure, code: 'insufficient_quota' }, 1, deadline, 'connecting')
        .stopReason,
    ).toBe('not_retryable')
    expect(
      retryDecision(policy, failure, policy.maxRetries + 1, deadline, 'connecting').stopReason,
    ).toBe('attempts_exhausted')
    expect(retryDecision(policy, failure, 1, Date.now(), 'connecting').stopReason).toBe(
      'budget_exhausted',
    )
  })

  it('只按已知临时错误判断，永久错误优先于网关的 5xx', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, enabled: true }
    const deadline = Date.now() + 900000
    expect(
      retryDecision(
        policy,
        { status: 200, code: 'server_is_overloaded' },
        1,
        deadline,
        'before_output',
      ).stopReason,
    ).toBeNull()
    expect(
      retryDecision(policy, { status: 503, code: 'insufficient_quota' }, 1, deadline, 'connecting')
        .stopReason,
    ).toBe('not_retryable')
    expect(
      retryDecision(policy, { status: 200, code: 'unknown_error' }, 1, deadline, 'before_output')
        .stopReason,
    ).toBe('not_retryable')
    expect(
      retryDecision(
        { ...policy, retryNetworkErrors: false },
        { status: 0 },
        1,
        deadline,
        'connecting',
      ).stopReason,
    ).toBe('not_retryable')
    expect(
      retryDecision(
        { ...policy, retryAfterOutput: false },
        { status: 0 },
        1,
        deadline,
        'after_output',
      ).stopReason,
    ).toBe('output_retry_disabled')
  })
  it('超过单个计时器上限仍按完整时长等待并支持取消', async () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const cancel = scheduleLongTimeout(callback, 3000000000)
    await vi.advanceTimersByTimeAsync(2999999999)
    expect(callback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(callback).toHaveBeenCalledTimes(1)
    cancel()
    const controller = new AbortController()
    const task = waitForRetry(3000000000, controller.signal)
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(2147483647)
    controller.abort()
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
  it('Retry-After 支持秒数与 HTTP 日期且不受退避间隔上限截断', () => {
    expect(retryAfterMs('4')).toBe(4000)
    expect(retryAfterMs('Wed, 16 Sep 2026 12:00:10 GMT', Date.parse('2026-09-16T12:00:00Z'))).toBe(
      10000,
    )
    expect(retryAfterMs('invalid')).toBe(0)
    const decision = retryDecision(
      { ...DEFAULT_RETRY_POLICY, enabled: true },
      { status: 429 },
      1,
      Date.now() + 900000,
      'connecting',
      120000,
    )
    expect(decision).toEqual({ delayMs: 120000, stopReason: null })
  })
})
