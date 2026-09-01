import { and, eq, inArray } from 'drizzle-orm'
import type { ContentPart } from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { costUsd as estimateCostUsd } from '@shared/util/cost'
import { db } from '../db/client'
import { conversations, errorLogs, messages, runEvents, runs, usageLogs } from '../db/schema'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import { UpstreamResponseLatencyTracker } from '../provider/response-timing'
import { computeGenerationDurationMs } from '../services/run-timing'
import { runEmitter } from './emitter'
import { storeGeneratedImageAttachment } from './generated-images'
import type { EngineContext } from './types'
import { errorTypeForAudit, terminalReasonForUsage } from './usage-audit'

interface ImageResponse {
  data?: { b64_json?: string; revised_prompt?: string }[]
  output_format?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    output_tokens_details?: { image_tokens?: number }
  }
}

/** 图片生成 run：按输入选择 /images/generations 或 /images/edits，落图为附件。 */
export async function runImageEngine(ctx: EngineContext): Promise<void> {
  let seq = 0
  const persistEmit = (type: string, data: Record<string, unknown>): number => {
    const sequenceNumber = seq++
    db.insert(runEvents).values({ runId: ctx.run.id, sequenceNumber, type, data }).run()
    db.update(runs).set({ lastSequenceNumber: sequenceNumber }).where(eq(runs.id, ctx.run.id)).run()
    runEmitter.emit({ runId: ctx.run.id, sequenceNumber, type, data })
    return sequenceNumber
  }

  const startedAt = new Date()
  const upstreamResponseTiming = new UpstreamResponseLatencyTracker()
  persistEmit(RUN_EVENT_TYPE.created, {
    runId: ctx.run.id,
    conversationId: ctx.conversation.id,
    assistantMessageId: ctx.assistantMessage.id,
    startedAt: startedAt.getTime(),
    reasoningEnabled: false,
  })
  db.update(runs).set({ state: 'running', startedAt }).where(eq(runs.id, ctx.run.id)).run()
  persistEmit('image.generation.in_progress', {
    generationId: 'image-0',
    callId: null,
    index: 0,
    outputIndex: null,
  })

  let state: 'completed' | 'failed' | 'canceled' = 'completed'
  let errorMessage: string | null = null
  let errorType: string | null = null
  let errorCode: string | null = null
  let httpStatus: number | null = null
  let attachmentId: string | null = null
  let revisedPrompt: string | null = null
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let imageTokens = 0

  try {
    const client = providerClientFromRow(ctx.provider, upstreamResponseTiming)
    const resp = (await (ctx.imageOperation === 'edit'
      ? client.editImage(ctx.body, ctx.abortController.signal)
      : client.createImage(ctx.body, ctx.abortController.signal))) as ImageResponse
    const item = resp.data?.[0]
    if (!item?.b64_json) throw new UpstreamError({ message: '上游未返回图片数据', status: 502 })

    const stored = storeGeneratedImageAttachment({
      userId: ctx.run.userId,
      messageId: ctx.assistantMessage.id,
      b64Json: item.b64_json,
      outputFormat: typeof resp.output_format === 'string' ? resp.output_format : null,
    })
    attachmentId = stored.attachmentId
    revisedPrompt = item.revised_prompt ?? null
    inputTokens = resp.usage?.input_tokens ?? 0
    outputTokens = resp.usage?.output_tokens ?? 0
    totalTokens = resp.usage?.total_tokens ?? 0
    imageTokens = resp.usage?.output_tokens_details?.image_tokens ?? outputTokens
    persistEmit('image.generation.completed', {
      generationId: 'image-0',
      callId: null,
      index: 0,
      outputIndex: null,
      attachmentId,
      revisedPrompt,
    })
  } catch (e) {
    if (ctx.abortController.signal.aborted) {
      state = 'canceled'
    } else {
      const ue = e instanceof UpstreamError ? e : null
      state = 'failed'
      errorMessage = ue?.message ?? (e instanceof Error ? e.message : '生成失败')
      errorType = ue?.type ?? null
      errorCode = ue?.code ?? null
      httpStatus = ue?.status ?? null
    }
  }

  const content: ContentPart[] = attachmentId
    ? [
        {
          type: 'image_result',
          attachment_id: attachmentId,
          revised_prompt: revisedPrompt ?? undefined,
        },
      ]
    : []
  const msgStatus =
    state === 'completed' ? 'complete' : state === 'failed' ? 'error' : 'interrupted'
  const finishedAt = new Date()
  const generationDurationMs = computeGenerationDurationMs(startedAt, finishedAt)
  const messageCostUsd = estimateCostUsd(
    {
      inputTokens,
      cacheWriteTokens: 0,
      cachedTokens: 0,
      outputTokens,
      imageTokens,
    },
    ctx.model.pricing,
  )
  const terminalReason = terminalReasonForUsage(state, { errorType, errorCode })
  const persistedErrorType = state === 'failed' ? errorTypeForAudit(errorType, errorCode) : null

  const finalized = db.transaction((tx) => {
    const finalizedRun = tx
      .update(runs)
      .set({ state, finishedAt, errorMessage, errorCode })
      .where(and(eq(runs.id, ctx.run.id), inArray(runs.state, ['queued', 'running'])))
      .returning({ id: runs.id })
      .get()
    if (!finalizedRun) return false

    tx.update(messages)
      .set({
        content,
        status: msgStatus,
        runId: ctx.run.id,
        reasoningDurationMs: null,
        generationDurationMs,
        inputTokens,
        cacheWriteTokens: 0,
        outputTokens,
        totalTokens,
        costUsd: messageCostUsd,
        errorMessage: errorMessage ?? (state === 'canceled' ? '已停止生成' : null),
      })
      .where(eq(messages.id, ctx.assistantMessage.id))
      .run()

    tx.update(conversations)
      .set({ activeLeafId: ctx.assistantMessage.id, modelId: ctx.model.id, updatedAt: finishedAt })
      .where(eq(conversations.id, ctx.conversation.id))
      .run()

    tx.insert(usageLogs)
      .values({
        runId: ctx.run.id,
        userId: ctx.run.userId,
        modelId: ctx.model.id,
        providerId: ctx.provider.id,
        modelLabel: ctx.model.modelId,
        modelDisplayName: ctx.model.displayName,
        providerLabel: ctx.provider.name,
        pricingSnapshot: ctx.model.pricing,
        conversationId: ctx.conversation.id,
        inputTokens,
        cacheWriteTokens: 0,
        outputTokens,
        totalTokens,
        imageTokens,
        upstreamResponseLatencyMs: upstreamResponseTiming.latencyMs,
        quotaAt: ctx.run.createdAt,
        outcome: state,
        terminalReason,
        success: state !== 'failed',
        errorType: persistedErrorType,
      })
      .run()

    if (state === 'failed' && errorMessage) {
      tx.insert(errorLogs)
        .values({
          runId: ctx.run.id,
          userId: ctx.run.userId,
          scope: 'upstream',
          errorType: persistedErrorType,
          code: errorCode,
          httpStatus,
          message: errorMessage,
        })
        .run()
    }
    return true
  })

  if (!finalized) return

  if (state === 'failed') {
    const terminalErrorCode = errorCode ?? persistedErrorType
    persistEmit(RUN_EVENT_TYPE.error, {
      state: 'failed',
      message: errorMessage ?? '生成失败',
      ...(terminalErrorCode ? { code: terminalErrorCode } : {}),
    })
  } else if (state === 'canceled') {
    persistEmit(RUN_EVENT_TYPE.canceled, { state: 'canceled' })
  } else {
    persistEmit(RUN_EVENT_TYPE.done, {
      state: 'completed',
      messageId: ctx.assistantMessage.id,
      usage: {
        inputTokens,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        outputTokens,
        reasoningTokens: 0,
        totalTokens,
      },
    })
  }
}
