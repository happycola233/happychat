import { responseDeltaIdentityKey } from '@shared/util/reasoningSummary'

export interface ReplayableRunEvent {
  type: string
  sequenceNumber: number
  data: Record<string, unknown>
}

const APPEND_DELTA_TYPES = new Set([
  'response.output_text.delta',
  'response.reasoning_summary_text.delta',
  'response.reasoning_text.delta',
])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function deltaReplayKey(ev: ReplayableRunEvent): string | null {
  if (!APPEND_DELTA_TYPES.has(ev.type)) return null
  return responseDeltaIdentityKey(ev.type, ev.data)
}

/**
 * 历史回放不需要逐 token 重演动画；把连续、同一输出槽位的 delta 合并，
 * 能避免刷新恢复时向浏览器灌入成千上万条 SSE 帧。
 */
export function compactRunEventsForReplay<T extends ReplayableRunEvent>(events: T[]): T[] {
  const compacted: T[] = []
  let previousKey: string | null = null

  for (const ev of events) {
    const key = deltaReplayKey(ev)
    const previous = compacted.at(-1)
    if (key && previous && previousKey === key) {
      compacted[compacted.length - 1] = {
        // 游标推进到最后一帧，观测时间保留首帧，避免回放压缩改变思考起点。
        ...previous,
        sequenceNumber: ev.sequenceNumber,
        data: {
          ...ev.data,
          delta: str(previous.data.delta) + str(ev.data.delta),
        },
      }
    } else {
      compacted.push(ev)
    }
    previousKey = key
  }

  return compacted
}
