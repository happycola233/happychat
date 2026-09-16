import type { RetryPolicy } from '@shared/schemas/retry'
import { retryDelayMs } from '@shared/schemas/retry'
import type { RunRetryData } from '@shared/types/events'
import { networkError, toUpstreamError, UpstreamError } from './errors'

export interface UpstreamRetryOptions {
  policy: RetryPolicy
  onProgress: (progress: RunRetryData) => void
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : 0
}

function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delay)
    function abort() {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * 仅重试尚未把响应交给引擎的 HTTP 请求。流式输出开始后不重放，
 * 避免重复正文、工具调用及已计费的图片；客户端断线不影响服务端计时。
 */
export async function fetchWithRetry(
  request: (signal?: AbortSignal) => Promise<Response>,
  signal?: AbortSignal,
  options?: UpstreamRetryOptions,
): Promise<Response> {
  if (!options?.policy.enabled) return request(signal)
  const { policy, onProgress } = options
  const deadline = Date.now() + policy.maxElapsedSeconds * 1000
  let attempt = 1
  for (;;) {
    signal?.throwIfAborted()
    if (attempt > 1)
      onProgress({
        phase: 'attempting',
        attempt,
        maxAttempts: policy.maxRetries + 1,
        nextRetryAt: null,
        reason: '正在重新连接',
      })
    const timeoutController = new AbortController()
    const timer = setTimeout(
      () => timeoutController.abort(),
      Math.min(policy.attemptTimeoutSeconds * 1000, Math.max(0, deadline - Date.now())),
    )
    const attemptSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal
    let failure: UpstreamError
    let retryAfter = 0
    try {
      const response = await request(attemptSignal)
      if (response.ok) {
        if (attempt > 1)
          onProgress({
            phase: 'connected',
            attempt,
            maxAttempts: policy.maxRetries + 1,
            nextRetryAt: null,
            reason: '已连接，正在生成',
          })
        return response
      }
      if (!policy.retryStatusCodes.includes(response.status)) return response
      retryAfter = retryAfterMs(response.headers.get('retry-after'))
      failure = await toUpstreamError(response)
    } catch (error) {
      signal?.throwIfAborted()
      failure = timeoutController.signal.aborted
        ? new UpstreamError({
            message: '等待上游响应超时，请稍后重试。',
            status: 0,
            type: 'timeout_error',
          })
        : error instanceof UpstreamError
          ? error
          : networkError(error)
    } finally {
      clearTimeout(timer)
    }
    // 金额耗尽与鉴权等永久失败即使被网关误用 429/5xx 表达，也不会反复扣请求。
    const permanent = [failure.code, failure.type].some(
      (code) =>
        code &&
        [
          'insufficient_quota',
          'billing_error',
          'billing_hard_limit_reached',
          'authentication_error',
          'permission_error',
          'invalid_api_key',
          'invalid_request_error',
        ].includes(code),
    )
    const retryable =
      failure.status === 0
        ? policy.retryNetworkErrors
        : policy.retryStatusCodes.includes(failure.status)
    const delay = Math.max(retryAfter, retryDelayMs(policy, attempt))
    if (permanent || !retryable || attempt > policy.maxRetries || Date.now() + delay >= deadline) {
      throw failure
    }
    onProgress({
      phase: 'waiting',
      attempt: attempt + 1,
      maxAttempts: policy.maxRetries + 1,
      nextRetryAt: Date.now() + delay,
      reason:
        failure.status === 429
          ? '服务当前繁忙'
          : failure.status === 0
            ? '暂时无法连接服务'
            : '服务暂时不可用',
    })
    await waitForRetry(delay, signal)
    // 事件循环阻塞或机器休眠后，计时器可能迟到；预算耗尽时不再发送新请求。
    if (Date.now() >= deadline) throw failure
    attempt += 1
  }
}
