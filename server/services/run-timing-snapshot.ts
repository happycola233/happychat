import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { db } from '../db/client'
import { runEvents } from '../db/schema'
import {
  computeReasoningDurationMs,
  REASONING_END_EVENT_TYPES,
  REASONING_START_EVENT_TYPES,
  type ReasoningTimingEvent,
} from './reasoning-timing'
import { computeFirstTokenLatencyMs, FIRST_OUTPUT_TOKEN_EVENT_TYPE } from './run-timing'

async function firstTimingEvent(
  runId: string,
  types: readonly string[],
  afterSequenceNumber?: number,
): Promise<ReasoningTimingEvent | null> {
  const conditions = [eq(runEvents.runId, runId), inArray(runEvents.type, [...types])]
  if (afterSequenceNumber !== undefined) {
    conditions.push(gt(runEvents.sequenceNumber, afterSequenceNumber))
  }

  const [event] = await db
    .select({
      type: runEvents.type,
      sequenceNumber: runEvents.sequenceNumber,
      createdAt: runEvents.createdAt,
      data: runEvents.data,
    })
    .from(runEvents)
    .where(and(...conditions))
    .orderBy(asc(runEvents.sequenceNumber))
    .limit(1)
  return event ?? null
}

async function timingEvents(
  runId: string,
  types: readonly string[],
  afterSequenceNumber: number,
): Promise<ReasoningTimingEvent[]> {
  return db
    .select({
      type: runEvents.type,
      sequenceNumber: runEvents.sequenceNumber,
      createdAt: runEvents.createdAt,
      data: runEvents.data,
    })
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        inArray(runEvents.type, [...types]),
        gt(runEvents.sequenceNumber, afterSequenceNumber),
      ),
    )
    .orderBy(asc(runEvents.sequenceNumber))
}

/** 在 run 被级联删除前固化首个可见正文相对生成起点的延迟。 */
export async function getFirstTokenLatencySnapshot(
  runId: string,
  startedAt: Date | null,
): Promise<number | null> {
  if (!startedAt) return null
  const firstOutput = await firstTimingEvent(runId, [FIRST_OUTPUT_TOKEN_EVENT_TYPE])
  return computeFirstTokenLatencyMs(startedAt, firstOutput?.createdAt.getTime() ?? null)
}

/** 只读取首个推理起点和结束点，避免在终结长回复时把全部 delta 事件加载进内存。 */
export async function getReasoningDurationSnapshot(
  runId: string,
  finishedAt: Date,
): Promise<number | null> {
  const start = await firstTimingEvent(runId, REASONING_START_EVENT_TYPES)
  if (!start) return null
  const answerLifecycle = await timingEvents(
    runId,
    [RUN_EVENT_TYPE.answerStarted, RUN_EVENT_TYPE.outputItemReclassified],
    start.sequenceNumber,
  )
  const hasAnswerStarted = answerLifecycle.some(
    (event) => event.type === RUN_EVENT_TYPE.answerStarted,
  )
  const fallbackEnd = hasAnswerStarted
    ? null
    : await firstTimingEvent(
        runId,
        REASONING_END_EVENT_TYPES.filter((type) => type !== RUN_EVENT_TYPE.answerStarted),
        start.sequenceNumber,
      )
  return computeReasoningDurationMs(
    [start, ...answerLifecycle, ...(fallbackEnd ? [fallbackEnd] : [])],
    finishedAt,
  )
}
