import { RUN_EVENT_TYPE } from '@shared/types/events'

export interface ReasoningTimingEvent {
  type: string
  sequenceNumber: number
  createdAt: Date
  data?: Record<string, unknown>
}

export const REASONING_START_EVENT_TYPES = [
  'response.created',
  'response.in_progress',
  'response.reasoning_summary_text.delta',
  'response.reasoning_text.delta',
] as const
export const REASONING_END_EVENT_TYPES = [
  RUN_EVENT_TYPE.answerStarted,
  'response.output_text.delta',
  RUN_EVENT_TYPE.done,
  RUN_EVENT_TYPE.error,
  RUN_EVENT_TYPE.canceled,
  RUN_EVENT_TYPE.interrupted,
] as const
export const REASONING_CONTEXT_EVENT_TYPES = [
  'response.output_item.added',
  'response.output_item.done',
  'response.completed',
  'response.incomplete',
  'response.failed',
  RUN_EVENT_TYPE.outputItemReclassified,
] as const
export const REASONING_TIMING_EVENT_TYPES = [
  ...REASONING_START_EVENT_TYPES,
  ...REASONING_END_EVENT_TYPES,
  ...REASONING_CONTEXT_EVENT_TYPES,
  RUN_EVENT_TYPE.outputReset,
  RUN_EVENT_TYPE.retry,
] as const

const REASONING_START_TYPES = new Set<string>(REASONING_START_EVENT_TYPES)
const TERMINAL_REASONING_END_TYPES = new Set<string>([
  RUN_EVENT_TYPE.done,
  RUN_EVENT_TYPE.error,
  RUN_EVENT_TYPE.canceled,
  RUN_EVENT_TYPE.interrupted,
])

/** 重试未输出时沿用旧内容；只有 output_reset 才切换到新一次尝试。 */
function visibleAttemptEvents(events: ReasoningTimingEvent[]): ReasoningTimingEvent[] {
  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  const resetIndex = sorted.findLastIndex((ev) => ev.type === RUN_EVENT_TYPE.outputReset)
  return sorted.slice(resetIndex + 1)
}

export function reasoningStartedAtMs(events: ReasoningTimingEvent[]): number | null {
  const started = visibleAttemptEvents(events).find(
    (ev) => REASONING_START_TYPES.has(ev.type) && ev.data?.delta !== '',
  )
  return started?.createdAt.getTime() ?? null
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** done 的最终 phase 与事后校正优先；进展说明不能作为旧事件流的终答首字。 */
export function reasoningCommentaryItemIds(events: ReasoningTimingEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.type === RUN_EVENT_TYPE.outputItemReclassified) {
      if (typeof event.data?.itemId === 'string') ids.add(event.data.itemId)
    } else if (
      event.type === 'response.output_item.added' ||
      event.type === 'response.output_item.done'
    ) {
      const item = record(event.data?.item)
      if (item?.type !== 'message' || typeof item.id !== 'string') continue
      if (item.phase === 'commentary') ids.add(item.id)
      else if (item.phase === 'final_answer') ids.delete(item.id)
    }
  }
  return ids
}

/**
 * 上游完整处理跨度明显长于本站收到事件的跨度，说明事件曾被缓冲，无法据此计时。
 * 比较时长而非两台机器的绝对时间；容许上游秒级时间戳最多一秒的量化误差。
 */
function hasBufferedResponseTiming(events: ReasoningTimingEvent[], startedAt: Date): boolean {
  return events.some((event) => {
    if (
      event.type !== 'response.completed' &&
      event.type !== 'response.incomplete' &&
      event.type !== 'response.failed'
    )
      return false
    const response = record(event.data?.response)
    if (typeof response?.created_at !== 'number' || typeof response.completed_at !== 'number')
      return false
    const upstreamDurationMs = (response.completed_at - response.created_at) * 1000
    const observedDurationMs = event.createdAt.getTime() - startedAt.getTime()
    return upstreamDurationMs - observedDurationMs > 1000
  })
}

export function computeReasoningDurationMs(
  events: ReasoningTimingEvent[],
  finishedAt: Date | null = null,
): number | null {
  const sorted = visibleAttemptEvents(events)
  const start = sorted.find((ev) => REASONING_START_TYPES.has(ev.type) && ev.data?.delta !== '')
  if (!start) return null
  if (hasBufferedResponseTiming(sorted, start.createdAt)) return null
  const afterStart = sorted.filter((ev) => ev.sequenceNumber > start.sequenceNumber)
  const retryWaiting = afterStart.find(
    (ev) => ev.type === RUN_EVENT_TYPE.retry && ev.data?.phase === 'waiting',
  )
  const commentaryItemIds = reasoningCommentaryItemIds(sorted)
  const answerStartedEvents = afterStart.filter((ev) => ev.type === RUN_EVENT_TYPE.answerStarted)
  const validAnswerStarted = answerStartedEvents.find((ev) => {
    const itemId = ev.data?.itemId
    return typeof itemId !== 'string' || !commentaryItemIds.has(itemId)
  })
  // 没有 answer.started 也可能是纯图片或只有进展说明；回退必须排除 commentary。
  const end =
    validAnswerStarted ??
    (answerStartedEvents.length === 0
      ? afterStart.find(
          (ev) =>
            ev.type === 'response.output_text.delta' &&
            ev.data?.delta !== '' &&
            !commentaryItemIds.has(String(ev.data?.item_id ?? '')),
        )
      : undefined) ??
    retryWaiting ??
    afterStart.find((ev) => TERMINAL_REASONING_END_TYPES.has(ev.type))
  if (!end && !finishedAt) return null

  // 终止事件在 run/message 落库后才写入，时间会略晚于 runs.finishedAt；无正文时以后者为准。
  const endAt =
    end?.type === RUN_EVENT_TYPE.answerStarted || end?.type === 'response.output_text.delta'
      ? end.createdAt
      : new Date(
          Math.min(
            end?.createdAt.getTime() ?? Number.POSITIVE_INFINITY,
            finishedAt?.getTime() ?? Number.POSITIVE_INFINITY,
          ),
        )
  return Math.max(0, endAt.getTime() - start.createdAt.getTime())
}
