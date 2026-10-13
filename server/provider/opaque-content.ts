const PROVIDER_OPAQUE_KEYS = new Set(['encrypted_content', 'encrypted_index', 'signature'])

/** 收集请求或事件中的提供商私有 opaque 值，供错误文案精确脱敏。 */
export function collectProviderOpaqueStrings(value: unknown): string[] {
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
      if (PROVIDER_OPAQUE_KEYS.has(key) && typeof nestedValue === 'string') {
        collected.add(nestedValue)
      } else if (
        key === 'data' &&
        (candidate as Record<string, unknown>).type === 'redacted_thinking' &&
        typeof nestedValue === 'string'
      ) {
        collected.add(nestedValue)
      } else {
        visit(nestedValue)
      }
    }
  }

  visit(value)
  return [...collected]
}

/** 必须在合并空白或截断前处理完整原文，避免私有值被切成无法匹配的片段。 */
export function redactProviderOpaqueContent(
  text: string,
  sensitiveValues: readonly string[] = [],
): string {
  let redacted = text.replace(
    /"(encrypted_content|encrypted_index|signature)"\s*:\s*"(?:\\.|[^"\\])*"/gi,
    '"$1":null',
  )
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue)
      redacted = redacted.replaceAll(sensitiveValue, '[provider opaque content omitted]')
  }
  return redacted
}
