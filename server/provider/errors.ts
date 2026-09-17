/** 上游/网络错误的归一异常，携带友好中文 message 及原始 type/code 供日志记录。 */
export class UpstreamError extends Error {
  readonly status: number
  readonly type?: string
  readonly code?: string
  readonly rawMessage?: string
  readonly retryAfterMs: number
  constructor(opts: {
    message: string
    status: number
    type?: string
    code?: string
    rawMessage?: string
    retryAfterMs?: number
  }) {
    super(opts.message)
    this.name = 'UpstreamError'
    this.status = opts.status
    this.type = opts.type
    this.code = opts.code
    this.rawMessage = opts.rawMessage
    this.retryAfterMs = opts.retryAfterMs ?? 0
  }
}

interface UpstreamErrorBody {
  error?: { message?: string; type?: string; code?: string; param?: string }
}

/** 依据上游 error.type / HTTP 状态映射为友好中文（不依赖 HTTP 码单一判断）。 */
export function friendlyUpstreamMessage(
  type: string | undefined,
  rawMessage: string | undefined,
  status: number,
): string {
  // 网关可能把整张 HTML 错误页包装进 JSON；原文仅用于诊断，不拼进用户提示。
  const textMessage =
    rawMessage && !/<!doctype\s+html\b|<html\b/i.test(rawMessage) ? rawMessage : undefined
  switch (type) {
    case 'authentication_error':
      return 'API Key 无效或未通过鉴权，请检查提供商的密钥。'
    case 'permission_error':
      return '该 API Key 无权访问此资源。'
    case 'invalid_request_error':
      return textMessage ? `请求参数有误：${textMessage}` : '请求参数有误。'
    case 'rate_limit_error':
    case 'rate_limit_exceeded':
      return '已触发上游限流，请稍后重试。'
    case 'overloaded_error':
    case 'server_is_overloaded':
    case 'server_overloaded':
      return '上游服务当前过载，请稍后重试。'
    case 'request_too_large':
      return '上游认为请求内容过大，请在「上下文优化」中减少历史记录或附件后重试。'
    case 'billing_error':
      return textMessage ? `Anthropic 账户计费异常：${textMessage}` : 'Anthropic 账户计费异常。'
    default:
      break
  }
  if (status === 524) return '上游服务响应超时（HTTP 524），请稍后重试。'
  if (type === 'server_error' || type === 'internal_server_error' || type === 'api_error') {
    return textMessage ? `上游服务返回错误：${textMessage}` : `上游服务返回错误（HTTP ${status}）。`
  }
  if (status === 401 || status === 403) return '上游鉴权失败，请检查 Base URL 与 API Key。'
  if (status === 404) return '上游接口不存在，请检查 Base URL 与提供商协议是否正确。'
  if (status === 429) return '已触发上游限流，请稍后重试。'
  if (status === 413) return '上游拒绝了过大的请求体，请减少附件或历史内容。'
  if (status === 529) return 'Anthropic 上游当前过载，请稍后重试。'
  if (status >= 500) return `上游服务暂时不可用（HTTP ${status}）。`
  return textMessage ?? `上游请求失败（HTTP ${status}）。`
}

export async function toUpstreamError(res: Response): Promise<UpstreamError> {
  let body: UpstreamErrorBody | null = null
  let rawMessage: string | undefined
  try {
    rawMessage = await res.text()
    body = JSON.parse(rawMessage) as UpstreamErrorBody
    rawMessage = body?.error?.message
  } catch {
    // 非 JSON 错误正文保留供诊断，HTML 由友好文案映射过滤。
  }
  const err = body?.error
  return new UpstreamError({
    message: friendlyUpstreamMessage(err?.type, rawMessage, res.status),
    status: res.status,
    type: err?.type,
    code: err?.code,
    rawMessage,
    retryAfterMs: retryAfterMs(res.headers.get('retry-after')),
  })
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : 0
}

/** 把网络层异常（DNS、超时、连接拒绝等）转为友好中文 UpstreamError。 */
export function networkError(e: unknown): UpstreamError {
  const msg = e instanceof Error ? e.message : String(e)
  return new UpstreamError({
    message: `无法连接上游服务：${msg}`,
    status: 0,
    type: 'network_error',
    rawMessage: msg,
  })
}
