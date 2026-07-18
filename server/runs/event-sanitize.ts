function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 收集请求或事件中明确标注为 encrypted_content 的 opaque 值，供错误文案精确脱敏。 */
export function collectEncryptedContentStrings(value: unknown): string[] {
  const collected = new Set<string>()
  const visited = new WeakSet<object>()

  const visit = (candidate: unknown): void => {
    if (typeof candidate !== 'object' || candidate === null) return
    if (visited.has(candidate)) return
    visited.add(candidate)

    if (Array.isArray(candidate)) {
      candidate.forEach(visit)
      return
    }

    for (const [key, nestedValue] of Object.entries(candidate)) {
      if (key === 'encrypted_content' && typeof nestedValue === 'string') {
        collected.add(nestedValue)
      } else {
        visit(nestedValue)
      }
    }
  }

  visit(value)
  return [...collected]
}

/** 错误消息可能回显请求字段；分类仍用原文，落库/SSE 前只保留脱敏文案。 */
export function redactEncryptedContent(
  text: string,
  sensitiveValues: readonly string[] = [],
): string {
  let redacted = text.replace(
    /"encrypted_content"\s*:\s*"(?:\\.|[^"\\])*"/gi,
    '"encrypted_content":null',
  )
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue)
      redacted = redacted.replaceAll(sensitiveValue, '[encrypted_content omitted]')
  }
  return redacted
}

/**
 * 移除只能留在服务端的上游大字段。
 *
 * 该函数不会原地修改上游事件：引擎仍可用原始对象完成最终校准、图片落盘和
 * reasoning replay context 提取；持久化与 SSE 则只接触返回的安全副本。
 */
function sanitizeOutputItem(item: unknown): unknown {
  if (!isRecord(item)) return item

  if (item.type === 'image_generation_call' && typeof item.result === 'string') {
    return { ...item, result: null, result_omitted: true }
  }

  if (item.type === 'reasoning' && typeof item.encrypted_content === 'string') {
    return {
      ...item,
      encrypted_content: null,
      encrypted_content_omitted: true,
    }
  }

  return item
}

function sanitizeResponse(response: unknown, sensitiveValues: readonly string[]): unknown {
  if (!isRecord(response)) return response
  let changed = false
  const output = Array.isArray(response.output)
    ? response.output.map((item) => {
        const sanitized = sanitizeOutputItem(item)
        if (sanitized !== item) changed = true
        return sanitized
      })
    : response.output

  let error = response.error
  if (isRecord(error) && typeof error.message === 'string') {
    const message = redactEncryptedContent(error.message, sensitiveValues)
    if (message !== error.message) {
      error = { ...error, message }
      changed = true
    }
  }

  return changed ? { ...response, output, error } : response
}

/**
 * 净化即将写入 run_events / 下发 SSE 的事件数据。
 * reasoning 密文无条件剥离，避免管理员通过模型硬参数请求密文时扩大泄漏面。
 */
export function sanitizeEventData(
  type: string,
  data: Record<string, unknown>,
  sensitiveValues: readonly string[] = [],
): Record<string, unknown> {
  // 终态或 item 自己可能首次带回新密文，把它也加入同一事件错误文案的脱敏集合。
  const eventSensitiveValues = [
    ...new Set([...sensitiveValues, ...collectEncryptedContentStrings(data)]),
  ]

  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    const item = sanitizeOutputItem(data.item)
    return item === data.item ? data : { ...data, item }
  }

  if (
    type === 'response.completed' ||
    type === 'response.incomplete' ||
    type === 'response.failed'
  ) {
    const response = sanitizeResponse(data.response, eventSensitiveValues)
    const message =
      typeof data.message === 'string'
        ? redactEncryptedContent(data.message, eventSensitiveValues)
        : data.message
    if (response === data.response && message === data.message) return data
    return { ...data, response, ...(message !== undefined ? { message } : {}) }
  }

  // 同时覆盖上游 error 与本地合成 run.error，确保最终错误帧也经过同一出口。
  if (typeof data.message === 'string') {
    const message = redactEncryptedContent(data.message, eventSensitiveValues)
    return message === data.message ? data : { ...data, message }
  }

  return data
}
