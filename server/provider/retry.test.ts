import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RETRY_POLICY } from '@shared/schemas/retry'
import { fetchWithRetry, retryAfterMs, type UpstreamRetryOptions } from './retry'

const options = (patch: Partial<UpstreamRetryOptions['policy']> = {}): UpstreamRetryOptions => ({
  policy: { ...DEFAULT_RETRY_POLICY, enabled: true, jitterPercent: 0, ...patch },
  onProgress: vi.fn(),
})
const unavailable = () => new Response('{"error":{"type":"server_error"}}', { status: 503 })
const pendingUntilAborted = (signal?: AbortSignal) =>
  new Promise<Response>((_, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })

afterEach(() => {
  vi.useRealTimers()
})

describe('上游请求自动重试', () => {
  it('按递增间隔重试并完整播报等待、尝试、恢复', async () => {
    vi.useFakeTimers()
    const request = vi
      .fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValue(new Response('ok'))
    const config = options()
    const result = fetchWithRetry(request, undefined, config)
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4999)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(request).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10000)
    expect(await (await result).text()).toBe('ok')
    expect(request).toHaveBeenCalledTimes(3)
    expect(
      vi.mocked(config.onProgress).mock.calls.map(([event]) => [event.phase, event.attempt]),
    ).toEqual([
      ['waiting', 2],
      ['attempting', 2],
      ['waiting', 3],
      ['attempting', 3],
      ['connected', 3],
    ])
  })

  it('等待阶段取消会立即结束且不再发送', async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockResolvedValue(unavailable())
    const controller = new AbortController()
    const result = fetchWithRetry(request, controller.signal, options())
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(60000)
    expect(request).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('遵守 Retry-After，且超过总等待预算时不发下一次', async () => {
    vi.useFakeTimers()
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '20' } }))
      .mockResolvedValue(new Response('ok'))
    const result = fetchWithRetry(request, undefined, options())
    await vi.advanceTimersByTimeAsync(19999)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).ok).toBe(true)
    const tooLate = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '1000' } }))
    await expect(fetchWithRetry(tooLate, undefined, options())).rejects.toMatchObject({
      status: 429,
    })
    expect(tooLate).toHaveBeenCalledTimes(1)
  })

  it('次数耗尽保留上游错误，401及余额耗尽不重试', async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockImplementation(unavailable)
    const result = fetchWithRetry(request, undefined, options({ maxRetries: 2 }))
    const rejected = expect(result).rejects.toMatchObject({ status: 503, type: 'server_error' })
    await vi.advanceTimersByTimeAsync(15000)
    await rejected
    expect(request).toHaveBeenCalledTimes(3)
    const unauthorized = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))
    expect((await fetchWithRetry(unauthorized, undefined, options())).status).toBe(401)
    expect(unauthorized).toHaveBeenCalledTimes(1)
    const noQuota = vi
      .fn()
      .mockResolvedValue(new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }))
    await expect(fetchWithRetry(noQuota, undefined, options())).rejects.toMatchObject({
      code: 'insufficient_quota',
    })
    expect(noQuota).toHaveBeenCalledTimes(1)
  })

  it('首响应超时可重试，收到响应后不干扰正文读取', async () => {
    vi.useFakeTimers()
    const request = vi
      .fn()
      .mockImplementationOnce(pendingUntilAborted)
      .mockResolvedValue(new Response('ok'))
    const result = fetchWithRetry(request, undefined, options({ attemptTimeoutSeconds: 5 }))
    await vi.advanceTimersByTimeAsync(10000)
    const response = await result
    await vi.advanceTimersByTimeAsync(600000)
    expect(await response.text()).toBe('ok')
    expect(request).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('单次等待超过计时器范围时仍在配置的时刻超时', async () => {
    vi.useFakeTimers()
    const request = vi.fn(pendingUntilAborted)
    const result = fetchWithRetry(
      request,
      undefined,
      options({
        attemptTimeoutSeconds: 3_000_000,
        maxElapsedSeconds: 6_000_000,
        retryNetworkErrors: false,
      }),
    )
    const rejected = expect(result).rejects.toMatchObject({ type: 'timeout_error' })
    await vi.advanceTimersByTimeAsync(3_000_000_000 - 1)
    expect(request.mock.calls[0]?.[0]?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(request).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('较大的总等待预算耗尽时结束正在连接的请求', async () => {
    vi.useFakeTimers()
    const request = vi.fn(pendingUntilAborted)
    const result = fetchWithRetry(
      request,
      undefined,
      options({ attemptTimeoutSeconds: 3600, maxElapsedSeconds: 9000 }),
    )
    const rejected = expect(result).rejects.toMatchObject({ type: 'timeout_error' })
    await vi.advanceTimersByTimeAsync(9_000_000 - 1)
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[2]?.[0]?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(request.mock.calls[2]?.[0]?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('长时间连接等待在分段后仍可立即取消', async () => {
    vi.useFakeTimers()
    const request = vi.fn(pendingUntilAborted)
    const controller = new AbortController()
    const result = fetchWithRetry(
      request,
      controller.signal,
      options({ attemptTimeoutSeconds: 3_000_000, maxElapsedSeconds: 6_000_000 }),
    )
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(2_147_483_647)
    controller.abort()
    await rejected
    expect(request).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('较大的 Retry-After 不会提前重试，连接成功后清理长计时器', async () => {
    vi.useFakeTimers()
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', { status: 429, headers: { 'Retry-After': '3000000' } }),
      )
      .mockResolvedValue(new Response('ok'))
    const result = fetchWithRetry(
      request,
      undefined,
      options({ attemptTimeoutSeconds: 3_000_000, maxElapsedSeconds: 6_000_000 }),
    )
    await vi.advanceTimersByTimeAsync(3_000_000_000 - 1)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await (await result).text()).toBe('ok')
    expect(request).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('关闭或排除网络错误时不会偷偷重试', async () => {
    const failed = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(fetchWithRetry(failed, undefined, options({ enabled: false }))).rejects.toThrow(
      'fetch failed',
    )
    expect(failed).toHaveBeenCalledTimes(1)
    failed.mockClear()
    await expect(
      fetchWithRetry(failed, undefined, options({ retryNetworkErrors: false })),
    ).rejects.toMatchObject({ status: 0 })
    expect(failed).toHaveBeenCalledTimes(1)
  })

  it('解析秒数与HTTP日期的等待时间', () => {
    expect(retryAfterMs('4')).toBe(4000)
    expect(retryAfterMs('Wed, 16 Sep 2026 12:00:10 GMT', Date.parse('2026-09-16T12:00:00Z'))).toBe(
      10000,
    )
    expect(retryAfterMs('invalid')).toBe(0)
  })
})
