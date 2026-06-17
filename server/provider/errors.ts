/** 上游/网络错误的归一异常，携带友好中文 message 及原始 type/code 供日志记录。 */
export class UpstreamError extends Error {
  readonly status: number
  readonly type?: string
  readonly code?: string
  readonly rawMessage?: string
  constructor(opts: {
    message: string
    status: number
    type?: string
    code?: string
    rawMessage?: string
  }) {
    super(opts.message)
    this.name = 'UpstreamError'
    this.status = opts.status
    this.type = opts.type
    this.code = opts.code
    this.rawMessage = opts.rawMessage
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
  switch (type) {
    case 'authentication_error':
      return 'API Key 无效或未通过鉴权，请检查提供商的密钥。'
    case 'permission_error':
      return '该 API Key 无权访问此资源。'
    case 'invalid_request_error':
      return rawMessage ? `请求参数有误：${rawMessage}` : '请求参数有误。'
    case 'rate_limit_error':
    case 'rate_limit_exceeded':
      return '已触发上游限流，请稍后重试。'
    case 'server_error':
    case 'internal_server_error':
      return rawMessage
        ? `上游服务返回错误：${rawMessage}`
        : `上游服务返回错误（HTTP ${status}）。`
    default:
      break
  }
  if (status === 401 || status === 403) return '上游鉴权失败，请检查 Base URL 与 API Key。'
  if (status === 404) return '上游接口不存在，请检查 Base URL 是否正确（应以 /v1 结尾）。'
  if (status === 429) return '已触发上游限流，请稍后重试。'
  if (status >= 500) return `上游服务暂时不可用（HTTP ${status}）。`
  return rawMessage ?? `上游请求失败（HTTP ${status}）。`
}

export async function toUpstreamError(res: Response): Promise<UpstreamError> {
  let body: UpstreamErrorBody | null = null
  try {
    body = (await res.json()) as UpstreamErrorBody
  } catch {
    // 非 JSON 响应忽略
  }
  const err = body?.error
  return new UpstreamError({
    message: friendlyUpstreamMessage(err?.type, err?.message, res.status),
    status: res.status,
    type: err?.type,
    code: err?.code,
    rawMessage: err?.message,
  })
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
