import { and, eq, inArray } from 'drizzle-orm'
import type { ContentPart } from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { db } from '../db/client'
import {
  attachments,
  conversations,
  errorLogs,
  messages,
  runEvents,
  runs,
  usageLogs,
} from '../db/schema'
import { newId } from '../lib/id'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import { saveUpload, sha256 } from '../storage/files'
import { runEmitter } from './emitter'
import type { EngineContext } from './types'

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
  persistEmit(RUN_EVENT_TYPE.created, {
    runId: ctx.run.id,
    conversationId: ctx.conversation.id,
    assistantMessageId: ctx.assistantMessage.id,
    startedAt: startedAt.getTime(),
    reasoningEnabled: false,
  })
  db.update(runs).set({ state: 'running', startedAt }).where(eq(runs.id, ctx.run.id)).run()
  persistEmit('image.generation.in_progress', {})

  let state: 'completed' | 'failed' | 'canceled' = 'completed'
  let errorMessage: string | null = null
  let attachmentId: string | null = null
  let revisedPrompt: string | null = null
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let imageTokens = 0

  try {
    const client = providerClientFromRow(ctx.provider)
    const resp = (await (ctx.imageOperation === 'edit'
      ? client.editImage(ctx.body, ctx.abortController.signal)
      : client.createImage(ctx.body, ctx.abortController.signal))) as ImageResponse
    const item = resp.data?.[0]
    if (!item?.b64_json) throw new UpstreamError({ message: '上游未返回图片数据', status: 502 })

    const buf = Buffer.from(item.b64_json, 'base64')
    const fmt = typeof resp.output_format === 'string' ? resp.output_format : 'png'
    const mime = `image/${fmt}`
    const id = newId()
    const storagePath = saveUpload(id, `generated.${fmt}`, mime, buf)
    db.insert(attachments)
      .values({
        id,
        userId: ctx.run.userId,
        messageId: ctx.assistantMessage.id,
        kind: 'image',
        mime,
        filename: `generated.${fmt}`,
        byteSize: buf.length,
        storagePath,
        sha256: sha256(buf),
      })
      .run()
    attachmentId = id
    revisedPrompt = item.revised_prompt ?? null
    inputTokens = resp.usage?.input_tokens ?? 0
    outputTokens = resp.usage?.output_tokens ?? 0
    totalTokens = resp.usage?.total_tokens ?? 0
    imageTokens = resp.usage?.output_tokens_details?.image_tokens ?? outputTokens
    persistEmit('image.generation.completed', { attachmentId, revisedPrompt })
  } catch (e) {
    if (ctx.abortController.signal.aborted) {
      state = 'canceled'
    } else {
      const ue = e instanceof UpstreamError ? e : null
      state = 'failed'
      errorMessage = ue?.message ?? (e instanceof Error ? e.message : '生成失败')
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

  db.update(messages)
    .set({
      content,
      status: msgStatus,
      runId: ctx.run.id,
      inputTokens,
      outputTokens,
      totalTokens,
      errorMessage: errorMessage ?? (state === 'canceled' ? '已停止生成' : null),
    })
    .where(eq(messages.id, ctx.assistantMessage.id))
    .run()

  db.update(runs)
    .set({ state, finishedAt: new Date(), errorMessage })
    .where(and(eq(runs.id, ctx.run.id), inArray(runs.state, ['queued', 'running'])))
    .run()

  db.update(conversations)
    .set({ activeLeafId: ctx.assistantMessage.id, modelId: ctx.model.id, updatedAt: new Date() })
    .where(eq(conversations.id, ctx.conversation.id))
    .run()

  db.insert(usageLogs)
    .values({
      runId: ctx.run.id,
      userId: ctx.run.userId,
      modelId: ctx.model.id,
      modelLabel: ctx.model.modelId,
      providerLabel: ctx.provider.name,
      conversationId: ctx.conversation.id,
      inputTokens,
      outputTokens,
      totalTokens,
      imageTokens,
      success: state !== 'failed',
      errorType: state === 'failed' ? 'error' : null,
    })
    .run()

  if (state === 'failed' && errorMessage) {
    db.insert(errorLogs)
      .values({
        runId: ctx.run.id,
        userId: ctx.run.userId,
        scope: 'upstream',
        message: errorMessage,
      })
      .run()
  }

  if (state === 'failed') {
    persistEmit(RUN_EVENT_TYPE.error, { state: 'failed', message: errorMessage ?? '生成失败' })
  } else if (state === 'canceled') {
    persistEmit(RUN_EVENT_TYPE.canceled, { state: 'canceled' })
  } else {
    persistEmit(RUN_EVENT_TYPE.done, {
      state: 'completed',
      messageId: ctx.assistantMessage.id,
      usage: { inputTokens, cachedTokens: 0, outputTokens, reasoningTokens: 0, totalTokens },
    })
  }
}
