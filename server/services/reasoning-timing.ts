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
] as const
export const REASONING_END_EVENT_TYPES = [
  RUN_EVENT_TYPE.answerStarted,
  'response.output_text.delta',
  RUN_EVENT_TYPE.done,
  RUN_EVENT_TYPE.error,
  RUN_EVENT_TYPE.canceled,
  RUN_EVENT_TYPE.interrupted,
] as const
export const REASONING_TIMING_EVENT_TYPES = [
  ...REASONING_START_EVENT_TYPES,
  ...REASONING_END_EVENT_TYPES,
  RUN_EVENT_TYPE.outputItemReclassified,
] as const

const REASONING_START_TYPES = new Set<string>(REASONING_START_EVENT_TYPES)
const TERMINAL_REASONING_END_TYPES = new Set<string>([
  RUN_EVENT_TYPE.done,
  RUN_EVENT_TYPE.error,
  RUN_EVENT_TYPE.canceled,
  RUN_EVENT_TYPE.interrupted,
])

export function reasoningStartedAtMs(events: ReasoningTimingEvent[]): number | null {
  const started = [...events]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .find((ev) => REASONING_START_TYPES.has(ev.type))
  return started?.createdAt.getTime() ?? null
}

export function computeReasoningDurationMs(
  events: ReasoningTimingEvent[],
  finishedAt: Date | null = null,
): number | null {
  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  const start = sorted.find((ev) => REASONING_START_TYPES.has(ev.type))
  if (!start) return null
  const afterStart = sorted.filter((ev) => ev.sequenceNumber > start.sequenceNumber)
  const reclassifiedItemIds = new Set(
    afterStart.flatMap((ev) => {
      if (ev.type !== RUN_EVENT_TYPE.outputItemReclassified) return []
      const itemId = ev.data?.itemId
      return typeof itemId === 'string' ? [itemId] : []
    }),
  )
  const answerStartedEvents = afterStart.filter((ev) => ev.type === RUN_EVENT_TYPE.answerStarted)
  const validAnswerStarted = answerStartedEvents.find((ev) => {
    const itemId = ev.data?.itemId
    return typeof itemId !== 'string' || !reclassifiedItemIds.has(itemId)
  })
  // 新事件优先于更早到达的 commentary delta；整条旧事件流没有它时才回落旧口径。
  const end =
    validAnswerStarted ??
    (answerStartedEvents.length === 0
      ? afterStart.find((ev) => ev.type === 'response.output_text.delta')
      : undefined) ??
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
