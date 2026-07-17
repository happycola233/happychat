import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { runEvents } from '../db/schema'
import {
  computeReasoningDurationMs,
  REASONING_END_EVENT_TYPES,
  REASONING_START_EVENT_TYPES,
  type ReasoningTimingEvent,
} from './reasoning-timing'

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
    })
    .from(runEvents)
    .where(and(...conditions))
    .orderBy(asc(runEvents.sequenceNumber))
    .limit(1)
  return event ?? null
}

/** 只读取首个推理起点和结束点，避免在终结长回复时把全部 delta 事件加载进内存。 */
export async function getReasoningDurationSnapshot(
  runId: string,
  finishedAt: Date,
): Promise<number | null> {
  const start = await firstTimingEvent(runId, REASONING_START_EVENT_TYPES)
  if (!start) return null
  const end = await firstTimingEvent(runId, REASONING_END_EVENT_TYPES, start.sequenceNumber)
  return computeReasoningDurationMs(end ? [start, end] : [start], finishedAt)
}
