import { RUN_EVENT_TYPE } from '@shared/types/events'

export interface ReasoningTimingEvent {
  type: string
  sequenceNumber: number
  createdAt: Date
}

const REASONING_START_TYPES = new Set([
  'response.created',
  'response.in_progress',
  'response.reasoning_summary_text.delta',
])
const REASONING_END_TYPES = new Set([
  'response.output_text.delta',
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

export function computeReasoningDurationMs(events: ReasoningTimingEvent[]): number | null {
  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  const start = sorted.find((ev) => REASONING_START_TYPES.has(ev.type))
  if (!start) return null
  const end = sorted.find(
    (ev) => ev.sequenceNumber > start.sequenceNumber && REASONING_END_TYPES.has(ev.type),
  )
  if (!end) return null
  return Math.max(0, end.createdAt.getTime() - start.createdAt.getTime())
}
