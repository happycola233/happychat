import { and, eq, inArray } from 'drizzle-orm'
import type {
  ContentPart,
  MessageUsage,
  ModelParams,
  UrlCitation,
  WebSearchAction,
} from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { db } from '../db/client'
import { conversations, errorLogs, messages, runs, usageLogs } from '../db/schema'
import { buildAssistantContent } from '../provider/normalize'
import type { ReasoningReplayContextV1 } from '../provider/reasoning-replay'
import { computeGenerationDurationMs } from '../services/run-timing'
import { getReasoningDurationSnapshot } from '../services/run-timing-snapshot'
import { maybeGenerateTitle } from '../services/title'
import type { ConvRow, ModelRow, MsgRow, ProviderRow, RunRow } from './types'

type FinalState = 'completed' | 'incomplete' | 'failed' | 'canceled'

export interface FinalizeArgs {
  run: RunRow
  assistantMessage: MsgRow
  conversation: ConvRow
  model: ModelRow
  provider: ProviderRow
  state: FinalState
  text: string
  reasoningSummary: string | null
  annotations: UrlCitation[]
  usage: MessageUsage
  /** web_search 工具实际执行的动作序列；仅 Responses 文本引擎传入。 */
  webSearchActions?: WebSearchAction[] | null
  incompleteReason: string | null
  errorMessage: string | null
  errorType?: string | null
  errorCode?: string | null
  httpStatus?: number | null
  upstreamResponseId: string | null
  reasoningReplayContext?: ReasoningReplayContextV1 | null
  startedAt: Date
  content?: ContentPart[]
  persistEmit: (type: string, data: Record<string, unknown>) => number
}

/**
 * 终止事件会在数据库最终态落稳后才发出，因此计算时同时传入 finishedAt，覆盖无正文输出。
 */
async function finalReasoningDurationMs(a: FinalizeArgs, finishedAt: Date): Promise<number | null> {
  if (!isReasoningEnabled(a.model, a.run.requestParams as ModelParams | null)) return null

  return getReasoningDurationSnapshot(a.run.id, finishedAt)
}

/** 终态处理（一次性 CAS）：落最终消息内容、usage_logs、run 状态，并发终止事件。 */
export async function finalizeRun(a: FinalizeArgs): Promise<void> {
  const msgStatus =
    a.state === 'completed' ? 'complete' : a.state === 'failed' ? 'error' : 'interrupted'
  const finishedAt = new Date()
  const generationDurationMs = computeGenerationDurationMs(a.startedAt, finishedAt)
  const reasoningDurationMs = await finalReasoningDurationMs(a, finishedAt)

  await db
    .update(messages)
    .set({
      content: a.content ?? buildAssistantContent(a.text),
      status: msgStatus,
      reasoningSummary: a.reasoningSummary,
      annotations: a.annotations.length ? a.annotations : null,
      // 搜索确实发生过就保留（含失败/取消），供 UI 复现搜索过程。
      webSearchActions: a.webSearchActions?.length ? a.webSearchActions : null,
      runId: a.run.id,
      reasoningDurationMs,
      generationDurationMs,
      inputTokens: a.usage.inputTokens,
      cacheWriteTokens: a.usage.cacheWriteTokens,
      cachedTokens: a.usage.cachedTokens,
      outputTokens: a.usage.outputTokens,
      reasoningTokens: a.usage.reasoningTokens,
      totalTokens: a.usage.totalTokens,
      // 仅写消息私有列；run.done、日志与面向浏览器的 DTO 都不携带该信封。
      reasoningReplayContext:
        a.state === 'completed' || a.state === 'incomplete'
          ? (a.reasoningReplayContext ?? null)
          : null,
      errorMessage:
        a.errorMessage ??
        (a.state === 'incomplete'
          ? '生成因长度限制被截断'
          : a.state === 'canceled'
            ? '已停止生成'
            : null),
    })
    .where(eq(messages.id, a.assistantMessage.id))

  // 仅当当前为非终态时写入（防止重复 finalize）
  await db
    .update(runs)
    .set({
      state: a.state,
      finishedAt,
      upstreamResponseId: a.upstreamResponseId,
      incompleteReason: a.incompleteReason,
      errorMessage: a.errorMessage,
    })
    .where(and(eq(runs.id, a.run.id), inArray(runs.state, ['queued', 'running'])))

  await db
    .update(conversations)
    .set({ activeLeafId: a.assistantMessage.id, modelId: a.model.id, updatedAt: new Date() })
    .where(eq(conversations.id, a.conversation.id))

  await db.insert(usageLogs).values({
    runId: a.run.id,
    userId: a.run.userId,
    modelId: a.model.id,
    providerId: a.provider.id,
    modelLabel: a.model.modelId,
    providerLabel: a.provider.name,
    conversationId: a.conversation.id,
    inputTokens: a.usage.inputTokens,
    cacheWriteTokens: a.usage.cacheWriteTokens,
    cachedTokens: a.usage.cachedTokens,
    outputTokens: a.usage.outputTokens,
    reasoningTokens: a.usage.reasoningTokens,
    totalTokens: a.usage.totalTokens,
    success: a.state !== 'failed',
    errorType: a.state === 'failed' ? (a.errorType ?? 'error') : null,
  })

  if (a.state === 'failed' && a.errorMessage) {
    await db.insert(errorLogs).values({
      runId: a.run.id,
      userId: a.run.userId,
      scope: 'upstream',
      errorType: a.errorType ?? null,
      code: a.errorCode ?? null,
      httpStatus: a.httpStatus ?? null,
      message: a.errorMessage,
    })
  }

  if (a.state === 'failed') {
    a.persistEmit(RUN_EVENT_TYPE.error, { state: 'failed', message: a.errorMessage ?? '生成失败' })
  } else if (a.state === 'canceled') {
    a.persistEmit(RUN_EVENT_TYPE.canceled, { state: 'canceled' })
  } else {
    a.persistEmit(RUN_EVENT_TYPE.done, {
      state: a.state,
      messageId: a.assistantMessage.id,
      // 与终态状态同帧交给前端，避免先清空流式内容再读取数据库造成闪烁。
      text: a.text,
      reasoningSummary: a.reasoningSummary,
      annotations: a.annotations,
      // 数组本身就是终态权威值：空数组会清掉前端未解析出动作的占位调用。
      ...(a.webSearchActions ? { webSearchActions: a.webSearchActions } : {}),
      usage: a.usage,
      incompleteReason: a.incompleteReason,
    })
    // 成功生成后异步总结标题（仅当会话尚无标题），不阻塞终结。
    void maybeGenerateTitle(a.conversation.id, a.run.id)
  }
}
