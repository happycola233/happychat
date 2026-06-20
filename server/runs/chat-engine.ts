import { eq } from 'drizzle-orm'
import type { MessageUsage, ModelParams } from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { db } from '../db/client'
import { runEvents, runs } from '../db/schema'
import { mapChatUsage } from '../provider/chat'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import { runEmitter } from './emitter'
import { finalizeRun } from './finalize'
import type { EngineContext } from './types'

/**
 * chat/completions 引擎：消费 chat 流，把 delta 翻译成与 Responses 一致的合成事件
 * （response.output_text.delta / response.reasoning_summary_text.delta），前端 reducer 无需改动。
 */
export async function runChatEngine(ctx: EngineContext): Promise<void> {
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
    reasoningEnabled: isReasoningEnabled(ctx.model, ctx.run.requestParams as ModelParams | null),
  })
  db.update(runs).set({ state: 'running', startedAt }).where(eq(runs.id, ctx.run.id)).run()
  // 让前端开始上游计时
  persistEmit('response.created', {})

  let text = ''
  let reasoning = ''
  let usage: MessageUsage = {
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
  let state: 'completed' | 'incomplete' | 'failed' | 'canceled' = 'completed'
  let incompleteReason: string | null = null
  let errorMessage: string | null = null
  let errorType: string | null = null
  let errorCode: string | null = null
  let httpStatus: number | null = null

  try {
    const client = providerClientFromRow(ctx.provider)
    for await (const chunk of client.createChatStream(ctx.body, ctx.abortController.signal)) {
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      if (delta?.reasoning_content) {
        reasoning += delta.reasoning_content
        persistEmit('response.reasoning_summary_text.delta', { delta: delta.reasoning_content })
      }
      if (delta?.content) {
        text += delta.content
        persistEmit('response.output_text.delta', { delta: delta.content })
      }
      if (chunk.usage) usage = mapChatUsage(chunk.usage)
      if (choice?.finish_reason === 'length') {
        state = 'incomplete'
        incompleteReason = 'max_output_tokens'
      }
    }
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

  await finalizeRun({
    run: ctx.run,
    assistantMessage: ctx.assistantMessage,
    conversation: ctx.conversation,
    model: ctx.model,
    provider: ctx.provider,
    state,
    text,
    reasoningSummary: reasoning || null,
    annotations: [],
    usage,
    incompleteReason,
    errorMessage,
    errorType,
    errorCode,
    httpStatus,
    upstreamResponseId: null,
    persistEmit,
  })
}
