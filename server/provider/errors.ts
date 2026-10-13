import { classifyRunError } from '@shared/util/runError'

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

/** 拼进用户文案的上游原文上限；完整原文仍在 rawMessage 中供管理员诊断。 */
const UPSTREAM_TEXT_EXCERPT_MAX = 300

/** 网关可能返回或在 JSON 中包装整张 HTML 错误页；这类原文只用于诊断，不拼进用户提示。 */
function upstreamTextExcerpt(rawMessage: string | undefined): string | null {
  if (!rawMessage || /<!doctype\s+html\b|<html\b/i.test(rawMessage)) return null
  const text = rawMessage.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > UPSTREAM_TEXT_EXCERPT_MAX
    ? `${text.slice(0, UPSTREAM_TEXT_EXCERPT_MAX)}…`
    : text
}

export interface UpstreamFailureInput {
  type?: string
  code?: string
  rawMessage?: string
  status: number
}

/**
 * 生成面向使用者的失败原因；处理建议由聊天界面按类别与当前身份补充，这里不重复。
 * 只有参数错误与无法归类的错误才引用上游原文：鉴权、计费、限流等原文可能含组织 ID 或密钥片段，
 * 服务端错误原文多为网关内部信息，用户既无法据此处理，也不应看到。完整原文保留在 rawMessage。
 */
export function friendlyUpstreamMessage({
  type,
  code,
  rawMessage,
  status,
}: UpstreamFailureInput): string {
  const kind = classifyRunError({
    errorType: type ?? null,
    errorCode: code ?? null,
    httpStatus: status,
  })
  const httpLabel = status >= 400 ? `（HTTP ${status}）` : ''
  switch (kind) {
    case 'context_too_large':
      return '对话内容超出了模型或上游服务可处理的上限。'
    case 'attachment_rejected':
      return '上游无法处理本次附带的图片。'
    case 'content_blocked':
      return '请求内容触发了上游安全策略，请调整内容后重试。'
    case 'billing':
      return '上游账户的余额、额度或支出上限不足。'
    case 'auth':
      return type === 'permission_error' || status === 403
        ? '上游服务拒绝访问当前模型或资源。'
        : '上游服务鉴权失败。'
    case 'not_found':
      return '上游找不到当前模型或接口。'
    case 'rate_limited':
      return '上游请求过于频繁，已被暂时限流。'
    case 'timeout':
      return `上游服务响应超时${httpLabel}。`
    case 'network':
      return '与上游服务的连接中断。'
    case 'overloaded':
      return '上游服务当前负载过高。'
    case 'server_error':
      return `上游服务暂时不可用${httpLabel}。`
    case 'invalid_response':
      return '上游返回了无法识别的响应。'
    case 'invalid_request': {
      const excerpt = upstreamTextExcerpt(rawMessage)
      return excerpt ? `上游不接受本次请求：${excerpt}` : '上游不接受本次请求的参数。'
    }
    case 'other':
      return upstreamTextExcerpt(rawMessage) ?? `上游请求失败${httpLabel}。`
  }
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
    message: friendlyUpstreamMessage({
      type: err?.type,
      code: err?.code,
      rawMessage,
      status: res.status,
    }),
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

/** Node fetch 把 ECONNRESET、ENOTFOUND 等底层原因放在 cause 中，诊断原文需要一并保留。 */
function networkDiagnostic(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  const cause = e instanceof Error ? e.cause : undefined
  if (!(cause instanceof Error)) return message
  const code = (cause as { code?: unknown }).code
  return `${message}（${typeof code === 'string' ? `${code}: ` : ''}${cause.message}）`
}

/**
 * 把网络层异常转为 UpstreamError。主机名、IP 与底层错误只进入诊断原文，
 * 用户只需要知道是连接不上，还是已经开始响应后断开。
 */
export function networkError(e: unknown, phase: 'connect' | 'response' = 'connect'): UpstreamError {
  return new UpstreamError({
    message: phase === 'response' ? '与上游服务的连接在响应过程中断开。' : '无法连接上游服务。',
    status: 0,
    type: 'network_error',
    rawMessage: networkDiagnostic(e),
  })
}
