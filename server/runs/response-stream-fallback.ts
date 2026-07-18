import { UpstreamError } from '../provider/errors'
import type { StreamEvent } from '../provider/sse-parse'

export type ResponseStreamFallback = 'unsupported_include' | 'invalid_reasoning_context'

interface ResponseStreamWithFallbackOptions {
  body: Record<string, unknown>
  openStream: (body: Record<string, unknown>) => AsyncIterable<StreamEvent>
  onFallback?: (fallback: ResponseStreamFallback) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 仅依据上游原始 type/code/message 识别可安全降级的 4xx。
 * Error.message 已被本地化为友好文案，刻意不参与判定。
 */
export function classifyResponseStreamFallback(error: unknown): ResponseStreamFallback | null {
  if (!(error instanceof UpstreamError) || error.status < 400 || error.status >= 500) return null

  const rawType = error.type?.toLowerCase() ?? ''
  const rawCode = error.code?.toLowerCase() ?? ''
  const rawMessage = error.rawMessage?.toLowerCase() ?? ''
  // 兼容 vendor 用 invalid_reasoning_item / invalid-reasoning-item 等 code 风格。
  const normalize = (value: string): string => value.replace(/[_./-]+/g, ' ')
  const raw = `${normalize(rawType)}\n${normalize(rawCode)}\n${normalize(rawMessage)}`

  const mentionsReasoning = /reasoning|encrypted content/.test(raw)
  const cannotUseReasoningItem =
    /decrypt|decryption|invalid.{0,80}encrypted content|encrypted content.{0,80}invalid|invalid reasoning item|reasoning item.{0,80}(invalid|not valid|not found)/.test(
      raw,
    )
  if (mentionsReasoning && cannotUseReasoningItem) return 'invalid_reasoning_context'

  const mentionsInclude = /\binclude\b|reasoning encrypted content/.test(raw)
  const unsupportedParameter =
    /unknown parameter|unsupported parameter|unrecognized parameter|invalid parameter/.test(raw) ||
    /unknown|unsupported|not supported|unrecognized|unexpected parameter/.test(raw)
  if (mentionsInclude && unsupportedParameter) return 'unsupported_include'

  return null
}

/** 为一次降级重试构造新的请求体，不原地修改初始审计快照。 */
export function buildFallbackResponseBody(
  body: Record<string, unknown>,
  fallback: ResponseStreamFallback,
): Record<string, unknown> | null {
  if (fallback === 'unsupported_include') {
    if (!Object.hasOwn(body, 'include')) return null
    const { include: _omittedInclude, ...withoutInclude } = body
    return withoutInclude
  }

  if (!Array.isArray(body.input)) return null
  const input = body.input.filter((item) => !(isRecord(item) && item.type === 'reasoning'))
  if (input.length === body.input.length) return null
  return { ...body, input }
}

/**
 * 建流 4xx 可降级时最多重试一次；任何上游事件一旦到达，后续错误直接抛出，
 * 防止已落库的 delta 在第二条流中重复出现。
 */
export async function* streamResponseWithFallback(
  options: ResponseStreamWithFallbackOptions,
): AsyncGenerator<StreamEvent> {
  let requestBody = options.body
  let hasRetried = false
  let receivedUpstreamEvent = false

  for (;;) {
    try {
      for await (const event of options.openStream(requestBody)) {
        receivedUpstreamEvent = true
        yield event
      }
      return
    } catch (error) {
      const fallback = hasRetried ? null : classifyResponseStreamFallback(error)
      const fallbackBody =
        !receivedUpstreamEvent && fallback ? buildFallbackResponseBody(requestBody, fallback) : null
      if (!fallback || !fallbackBody) throw error

      hasRetried = true
      requestBody = fallbackBody
      options.onFallback?.(fallback)
    }
  }
}
