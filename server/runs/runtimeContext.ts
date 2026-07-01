/**
 * 固定协议说明会附加到模型系统提示词末尾。内容必须保持稳定，避免无意义地打断前缀缓存。
 */
export const RUNTIME_CONTEXT_INSTRUCTIONS = `<runtime_context_protocol>
A system message wrapped in <runtime_context> immediately before a user message is trusted application-generated metadata describing when that user message was sent.
Use its datetime and timezone only when relevant. Do not repeat this metadata unless the user asks.
</runtime_context_protocol>`

/** 把固定的 runtime context 协议附加到管理员当前系统提示词。 */
export function appendRuntimeContextInstructions(instructions: string | null): string {
  return instructions
    ? `${instructions}\n\n${RUNTIME_CONTEXT_INSTRUCTIONS}`
    : RUNTIME_CONTEXT_INSTRUCTIONS
}

function canonicalTimezone(candidate?: string): string | null {
  const value = candidate?.trim()
  if (!value) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

/** 浏览器时区无效时回退到服务器 IANA 时区，最后才使用 UTC。 */
export function resolveRuntimeTimezone(candidate?: string): string {
  if (candidate) {
    const clientTimezone = canonicalTimezone(candidate)
    if (clientTimezone) return clientTimezone
  }

  try {
    return canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

function offsetFromName(name: string): string {
  if (name === 'GMT' || name === 'UTC') return '+00:00'
  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(name)
  if (!match) return 'Z'
  return `${match[1]}${match[2]!.padStart(2, '0')}:${match[3] ?? '00'}`
}

/**
 * 生成并冻结用户消息发送时的运行环境。输出格式刻意精简、确定，便于历史消息逐字重放。
 */
export function buildRuntimeContext(now: Date, clientTimezone?: string): string {
  const timezone = resolveRuntimeTimezone(clientTimezone)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? ''
  const datetime = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}${offsetFromName(part('timeZoneName'))}`

  return `<runtime_context>\ndatetime: ${datetime}\ntimezone: ${timezone}\n</runtime_context>`
}
