export interface ReasoningSummaryAccumulator {
  text: string
  /** OpenAI Responses API 当前 summary part 的稳定标识；兼容无结构化索引的上游时为 null。 */
  partKey: string | null
}

const DELTA_IDENTITY_FIELDS = ['item_id', 'output_index', 'content_index', 'summary_index'] as const

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function edgeNewlineCount(text: string, edge: 'start' | 'end'): number {
  const match = edge === 'start' ? text.match(/^(?:[\t ]*\r?\n)+/) : text.match(/(?:\r?\n[\t ]*)+$/)
  return match ? (match[0].match(/\n/g) ?? []).length : 0
}

/**
 * 以 Markdown 段落边界连接独立的 reasoning summary part。
 *
 * OpenAI 的 summary 是结构化数组，part 文本本身不保证携带换行。这里只补足缺少的
 * 换行，不裁剪上游内容，也不会给已经自带段落边界的兼容上游重复添加空行。
 */
export function joinReasoningSummaryParts(parts: Iterable<string>): string {
  let joined = ''

  for (const part of parts) {
    if (!part) continue
    if (!joined) {
      joined = part
      continue
    }

    const existingNewlines = edgeNewlineCount(joined, 'end') + edgeNewlineCount(part, 'start')
    joined += `${'\n'.repeat(Math.max(0, 2 - existingNewlines))}${part}`
  }

  return joined
}

/** 读取 reasoning delta 所属的 summary part；无结构字段的 chat/completions 事件返回 null。 */
export function reasoningSummaryPartKey(data: Record<string, unknown>): string | null {
  const itemId = stringValue(data.item_id) || null
  const outputIndex = numberValue(data.output_index)
  const summaryIndex = numberValue(data.summary_index)
  // summary_index 才是 part 边界；item_id 优先于冗余的 output_index，避免兼容上游
  // 偶尔省略 output_index 时把同一 part 错判为新段。
  if (summaryIndex === null) return null
  if (itemId !== null) return JSON.stringify(['item', itemId, summaryIndex])
  if (outputIndex !== null) return JSON.stringify(['output', outputIndex, summaryIndex])
  return null
}

/**
 * 追加一个流式 reasoning delta。同一 part 内逐 token 紧密拼接；part 发生变化时保留
 * 官方 summary_index 表达的段落语义。没有 part 标识的兼容事件继续沿用普通 token 拼接。
 */
export function appendReasoningSummaryDelta(
  current: ReasoningSummaryAccumulator,
  data: Record<string, unknown>,
): ReasoningSummaryAccumulator {
  const delta = stringValue(data.delta)
  const nextPartKey = reasoningSummaryPartKey(data)
  // 空 delta 不代表 part 已经产生可见内容；提前切换 key 会吞掉随后首个非空 delta 的边界。
  if (!delta) return current

  const startsNewPart =
    current.text.length > 0 &&
    current.partKey !== null &&
    nextPartKey !== null &&
    current.partKey !== nextPartKey

  return {
    text: startsNewPart ? joinReasoningSummaryParts([current.text, delta]) : current.text + delta,
    partKey: nextPartKey ?? current.partKey,
  }
}

/** 生成可用于 SSE 回放/批处理压缩的 delta 槽位 key，避免跨输出 part 合并。 */
export function responseDeltaIdentityKey(
  type: string,
  data: Record<string, unknown>,
): string | null {
  if (typeof data.delta !== 'string') return null
  return JSON.stringify([type, ...DELTA_IDENTITY_FIELDS.map((field) => data[field] ?? null)])
}
