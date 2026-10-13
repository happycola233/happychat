import type { RunErrorIdentity } from '../types/domain'

/**
 * 面向使用者的失败原因类别。服务端据此生成原因文案，聊天界面据此补充处理建议，
 * 两端共用同一份判定，避免“上游已明确告知原因，界面却只显示参数有误”。
 */
export type RunErrorKind =
  | 'context_too_large'
  | 'attachment_rejected'
  | 'content_blocked'
  | 'billing'
  | 'auth'
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'overloaded'
  | 'server_error'
  | 'invalid_response'
  | 'invalid_request'
  | 'other'

/** 能单独说明原因的 type/code；优先于 HTTP 状态判定，code 又优先于 type。 */
const SPECIFIC_ERROR_IDS: Partial<Record<RunErrorKind, readonly string[]>> = {
  context_too_large: [
    'context_length_exceeded',
    'context_too_large',
    'request_too_large',
    'string_above_max_length',
  ],
  // Responses 的图片输入错误码；通常需要更换本次上传的图片。
  attachment_rejected: [
    'invalid_image',
    'invalid_image_format',
    'invalid_base64_image',
    'invalid_image_url',
    'image_too_large',
    'image_too_small',
    'image_parse_error',
    'invalid_image_mode',
    'image_file_too_large',
    'unsupported_image_media_type',
    'empty_image_file',
    'failed_to_download_image',
    'image_file_not_found',
  ],
  content_blocked: [
    'refusal',
    'content_filter',
    'content_policy_violation',
    'image_content_policy_violation',
    'moderation_blocked',
    'invalid_prompt',
    'bio_policy',
    'misalignment_policy_violation',
  ],
  // OpenAI 的余额/支出上限会以 HTTP 429 返回，必须先于限流判定。
  billing: [
    'insufficient_quota',
    'billing_error',
    'billing_hard_limit_reached',
    'credit_balance_exhausted',
    'quota_exceeded',
    'organization_spend_limit_exceeded',
    'project_spend_limit_exceeded',
    'organization_usage_limit_exceeded',
  ],
  auth: ['authentication_error', 'permission_error', 'invalid_api_key'],
  not_found: ['not_found_error', 'model_not_found'],
  rate_limited: ['rate_limit_error', 'rate_limit_exceeded', 'too_many_requests', 'slow_down'],
  timeout: ['first_output_timeout', 'stream_idle_timeout', 'timeout_error', 'request_timeout'],
  network: ['network_error', 'incomplete_stream', 'upstream_http2_stream_error'],
  overloaded: [
    'overloaded_error',
    'server_is_overloaded',
    'server_overloaded',
    'service_unavailable',
    'service_unavailable_error',
    'temporarily_unavailable',
  ],
  invalid_response: [
    'invalid_stream',
    'invalid_response',
    'malformed_sse_json',
    'invalid_sse_payload',
    'unsupported_finish_reason',
  ],
  invalid_request: [
    'invalid_value',
    'unsupported_parameter',
    'unsupported_value',
    'missing_required_parameter',
  ],
}

/** 笼统的协议 type 只在 HTTP 状态也无法说明原因时使用，例如 413 + invalid_request_error。 */
const GENERIC_ERROR_IDS: Partial<Record<RunErrorKind, readonly string[]>> = {
  invalid_request: ['invalid_request_error'],
  server_error: ['server_error', 'internal_server_error', 'api_error'],
}

function lookup(
  table: Partial<Record<RunErrorKind, readonly string[]>>,
  ids: readonly string[],
): RunErrorKind | null {
  for (const id of ids) {
    for (const [kind, values] of Object.entries(table)) {
      if (values.includes(id)) return kind as RunErrorKind
    }
  }
  return null
}

function kindFromHttpStatus(status: number | null): RunErrorKind | null {
  if (status === null || status < 400) return null
  if (status === 413) return 'context_too_large'
  if (status === 402) return 'billing'
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status === 408 || status === 504 || status === 524) return 'timeout'
  if (status === 503 || status === 529) return 'overloaded'
  if (status >= 500) return 'server_error'
  if (status === 400 || status === 422) return 'invalid_request'
  return null
}

/** 依据结构化 type/code 与 HTTP 状态归类；不解析上游英文文案。 */
export function classifyRunError(error: RunErrorIdentity): RunErrorKind {
  const ids = [error.errorCode, error.errorType].filter((id): id is string => Boolean(id))
  return (
    lookup(SPECIFIC_ERROR_IDS, ids) ??
    kindFromHttpStatus(error.httpStatus) ??
    lookup(GENERIC_ERROR_IDS, ids) ??
    'other'
  )
}

/** 只有上游明确返回的错误状态值得展示；连接失败与流内错误的 0/200 只会造成误解。 */
export function displayableHttpStatus(status: number | null): number | null {
  return status !== null && status >= 400 ? status : null
}
