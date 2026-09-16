import type { RetryPolicy } from '@shared/schemas/retry'
import { retryDelayMs } from '@shared/schemas/retry'
import type { RetryFailureStage, RetryStopReason } from '@shared/types/retry'
import type { UpstreamError } from './errors'
export { retryAfterMs } from './errors'

const PERMANENT_ERRORS = new Set([
  'insufficient_quota',
  'billing_error',
  'billing_hard_limit_reached',
  'quota_exceeded',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'authentication_error',
  'permission_error',
  'invalid_api_key',
  'invalid_request_error',
  'context_length_exceeded',
  'request_too_large',
  'not_found_error',
  'model_not_found',
  'refusal',
  'content_filter',
  'content_policy_violation',
  'tool_calls',
  'tool_use',
  'pause_turn_limit',
  'invalid_stream',
  'invalid_response',
  'unsupported_finish_reason',
])

const TRANSIENT_ERROR_STATUS: Record<string, number> = {
  server_error: 500,
  internal_server_error: 500,
  api_error: 500,
  server_is_overloaded: 503,
  server_overloaded: 503,
  overloaded_error: 529,
  rate_limit_exceeded: 429,
  rate_limit_error: 429,
  too_many_requests: 429,
  service_unavailable: 503,
  service_unavailable_error: 503,
  temporarily_unavailable: 503,
  slow_down: 429,
  request_timeout: 408,
  timeout_error: 504,
  conflict_error: 409,
}

/** SSE 错误用结构化 code/type 匹配同类临时错误；绝不把推断值当作真实 HTTP 状态入账。 */
export function retryDecision(
  policy: RetryPolicy,
  failure: Pick<UpstreamError, 'status' | 'type' | 'code'>,
  attempt: number,
  deadline: number,
  stage: RetryFailureStage,
  retryAfter = 0,
): { delayMs: number; stopReason: RetryStopReason | null } {
  const delayMs = Math.max(retryAfter, retryDelayMs(policy, attempt))
  let stopReason: RetryStopReason | null = null
  const codes = [failure.code, failure.type].filter((code): code is string => Boolean(code))
  const network =
    failure.status === 0 ||
    codes.some((code) =>
      [
        'network_error',
        'incomplete_stream',
        'first_output_timeout',
        'stream_idle_timeout',
      ].includes(code),
    )
  const status =
    failure.status >= 400
      ? failure.status
      : codes.map((code) => TRANSIENT_ERROR_STATUS[code]).find(Boolean)
  const retryable =
    !codes.some((code) => PERMANENT_ERRORS.has(code)) &&
    (network
      ? policy.retryNetworkErrors
      : status !== undefined && policy.retryStatusCodes.includes(status))
  if (!policy.enabled) stopReason = 'disabled'
  else if (!retryable) stopReason = 'not_retryable'
  else if (stage === 'after_output' && !policy.retryAfterOutput)
    stopReason = 'output_retry_disabled'
  else if (attempt > policy.maxRetries) stopReason = 'attempts_exhausted'
  else if (Date.now() + delayMs >= deadline) stopReason = 'budget_exhausted'
  return { delayMs, stopReason }
}

/** Node.js 超过 32 位有符号整数的延时会变成 1ms；分段计时以保留完整等待时长。 */
export function scheduleLongTimeout(callback: () => void, delayMs: number): () => void {
  const maxTimerDelayMs = 2_147_483_647
  const deadline = Date.now() + delayMs
  let timer = setTimeout(checkDeadline, Math.min(delayMs, maxTimerDelayMs))
  function checkDeadline() {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) callback()
    else timer = setTimeout(checkDeadline, Math.min(remainingMs, maxTimerDelayMs))
  }
  return () => clearTimeout(timer)
}

export function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cancelTimeout = scheduleLongTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delay)
    function abort() {
      cancelTimeout()
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
