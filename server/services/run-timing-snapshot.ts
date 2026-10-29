import { and, asc, desc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { db } from '../db/client'
import { runEvents } from '../db/schema'
import {
  computeReasoningDurationMs,
  reasoningCommentaryItemIds,
  REASONING_CONTEXT_EVENT_TYPES,
  REASONING_END_EVENT_TYPES,
  REASONING_START_EVENT_TYPES,
  type ReasoningTimingEvent,
} from './reasoning-timing'
import { computeFirstTokenLatencyMs, FIRST_OUTPUT_TOKEN_EVENT_TYPE } from './run-timing'

/** 计时只读取边界元数据，避免把终态全文、工具结果和所有 delta 文本重复载入内存。 */
export const reasoningTimingEventColumns = {
  type: runEvents.type,
  sequenceNumber: runEvents.sequenceNumber,
  createdAt: runEvents.createdAt,
  data: sql<string>`json_object(
    'delta', case when json_extract(${runEvents.data}, '$.delta') = '' then '' end,
    'item_id', json_extract(${runEvents.data}, '$.item_id'),
    'itemId', json_extract(${runEvents.data}, '$.itemId'),
    'phase', json_extract(${runEvents.data}, '$.phase'),
    'item', json_object(
      'id', json_extract(${runEvents.data}, '$.item.id'),
      'type', json_extract(${runEvents.data}, '$.item.type'),
      'phase', json_extract(${runEvents.data}, '$.item.phase')
    ),
    'response', json_object(
      'created_at', json_extract(${runEvents.data}, '$.response.created_at'),
      'completed_at', json_extract(${runEvents.data}, '$.response.completed_at')
    )
  )`.mapWith((value) => JSON.parse(value) as Record<string, unknown>),
}

async function firstTimingEvent(
  runId: string,
  types: readonly string[],
  afterSequenceNumber?: number,
  excludedItemIds: ReadonlySet<string> = new Set(),
): Promise<ReasoningTimingEvent | null> {
  const conditions = [
    eq(runEvents.runId, runId),
    inArray(runEvents.type, [...types]),
    // 空 delta 只是占位，不能成为思考起点、终答首字或旧事件流的结束点。
    sql`coalesce(json_extract(${runEvents.data}, '$.delta'), ' ') <> ''`,
  ]
  if (afterSequenceNumber !== undefined) {
    conditions.push(gt(runEvents.sequenceNumber, afterSequenceNumber))
  }
  if (excludedItemIds.size) {
    conditions.push(
      notInArray(sql`coalesce(json_extract(${runEvents.data}, '$.item_id'), '')`, [
        ...excludedItemIds,
      ]),
    )
  }

  const [event] = await db
    .select(reasoningTimingEventColumns)
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
    .select(reasoningTimingEventColumns)
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

/** 恢复与结算共用当前可见尝试的计时，不加载长回复的全部 delta。 */
export async function getReasoningTimingSnapshot(
  runId: string,
  finishedAt: Date | null = null,
): Promise<{ upstreamStartedAt: number | null; reasoningDurationMs: number | null }> {
  const [reset] = await db
    .select({ sequenceNumber: runEvents.sequenceNumber })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, RUN_EVENT_TYPE.outputReset)))
    .orderBy(desc(runEvents.sequenceNumber))
    .limit(1)
  const start = await firstTimingEvent(runId, REASONING_START_EVENT_TYPES, reset?.sequenceNumber)
  if (!start) return { upstreamStartedAt: null, reasoningDurationMs: null }
  const processLifecycle = await timingEvents(
    runId,
    [RUN_EVENT_TYPE.answerStarted, RUN_EVENT_TYPE.retry, ...REASONING_CONTEXT_EVENT_TYPES],
    reset?.sequenceNumber ?? -1,
  )
  const hasAnswerStarted = processLifecycle.some(
    (event) => event.type === RUN_EVENT_TYPE.answerStarted,
  )
  const fallbackEnd = hasAnswerStarted
    ? null
    : await firstTimingEvent(
        runId,
        REASONING_END_EVENT_TYPES.filter((type) => type !== RUN_EVENT_TYPE.answerStarted),
        start.sequenceNumber,
        reasoningCommentaryItemIds(processLifecycle),
      )
  return {
    upstreamStartedAt: start.createdAt.getTime(),
    reasoningDurationMs: computeReasoningDurationMs(
      [start, ...processLifecycle, ...(fallbackEnd ? [fallbackEnd] : [])],
      finishedAt,
    ),
  }
}

export async function getReasoningDurationSnapshot(
  runId: string,
  finishedAt: Date,
): Promise<number | null> {
  return (await getReasoningTimingSnapshot(runId, finishedAt)).reasoningDurationMs
}
