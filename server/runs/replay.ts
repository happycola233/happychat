export interface ReplayableRunEvent {
  type: string
  sequenceNumber: number
  data: Record<string, unknown>
}

const APPEND_DELTA_TYPES = new Set([
  'response.output_text.delta',
  'response.reasoning_summary_text.delta',
])

const DELTA_IDENTITY_FIELDS = ['item_id', 'output_index', 'content_index', 'summary_index']

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function deltaReplayKey(ev: ReplayableRunEvent): string | null {
  if (!APPEND_DELTA_TYPES.has(ev.type)) return null
  if (typeof ev.data.delta !== 'string') return null
  return JSON.stringify([
    ev.type,
    ...DELTA_IDENTITY_FIELDS.map((field) => ev.data[field] ?? null),
  ])
}

/**
 * 历史回放不需要逐 token 重演动画；把连续、同一输出槽位的 delta 合并，
 * 能避免刷新恢复时向浏览器灌入成千上万条 SSE 帧。
 */
export function compactRunEventsForReplay(events: ReplayableRunEvent[]): ReplayableRunEvent[] {
  const compacted: ReplayableRunEvent[] = []
  let pending: ReplayableRunEvent | null = null
  let pendingKey: string | null = null

  const flushPending = () => {
    if (!pending) return
    compacted.push(pending)
    pending = null
    pendingKey = null
  }

  for (const ev of events) {
    const key = deltaReplayKey(ev)
    if (!key) {
      flushPending()
      compacted.push(ev)
      continue
    }

    if (pending && pendingKey === key) {
      pending = {
        type: ev.type,
        sequenceNumber: ev.sequenceNumber,
        data: {
          ...ev.data,
          delta: str(pending.data.delta) + str(ev.data.delta),
        },
      }
      continue
    }

    flushPending()
    pending = { type: ev.type, sequenceNumber: ev.sequenceNumber, data: { ...ev.data } }
    pendingKey = key
  }

  flushPending()
  return compacted
}
