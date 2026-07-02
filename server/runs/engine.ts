import { eq } from 'drizzle-orm'
import type { MessageUsage, ModelParams, UrlCitation } from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { db } from '../db/client'
import { runEvents, runs } from '../db/schema'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import type { UpstreamResponse } from '../provider/upstream-types'
import { runEmitter } from './emitter'
import { reconcileFinalResponse } from './final-response'
import { finalizeRun } from './finalize'
import type { EngineContext } from './types'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function pushCitation(arr: UrlCitation[], annotation: unknown): void {
  if (typeof annotation !== 'object' || annotation === null) return
  const a = annotation as Record<string, unknown>
  if (a.type === 'url_citation' && typeof a.url === 'string') {
    arr.push({
      type: 'url_citation',
      url: a.url,
      title: str(a.title),
      start_index: typeof a.start_index === 'number' ? a.start_index : 0,
      end_index: typeof a.end_index === 'number' ? a.end_index : 0,
    })
  }
}

/** 驱动单个 run：流式调用上游 → 逐事件持久化到 run_events + 发射 → 终结。 */
export async function runEngine(ctx: EngineContext): Promise<void> {
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

  let text = ''
  let reasoning = ''
  let annotations: UrlCitation[] = []
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
  let upstreamResponseId: string | null = null

  const applyFinalResponse = (response: UpstreamResponse | undefined): void => {
    const reconciled = reconcileFinalResponse(
      {
        text,
        reasoningSummary: reasoning || null,
        annotations,
        usage,
        upstreamResponseId,
      },
      response,
    )
    text = reconciled.text
    reasoning = reconciled.reasoningSummary ?? ''
    annotations = reconciled.annotations
    usage = reconciled.usage
    upstreamResponseId = reconciled.upstreamResponseId
  }

  try {
    const client = providerClientFromRow(ctx.provider)
    for await (const ev of client.createResponseStream(ctx.body, ctx.abortController.signal)) {
      persistEmit(ev.type, ev.data)
      switch (ev.type) {
        case 'response.output_text.delta':
          text += str(ev.data.delta)
          break
        case 'response.reasoning_summary_text.delta':
          reasoning += str(ev.data.delta)
          break
        case 'response.output_text.annotation.added':
          pushCitation(annotations, ev.data.annotation)
          break
        case 'response.completed': {
          const resp = ev.data.response as UpstreamResponse | undefined
          applyFinalResponse(resp)
          state = 'completed'
          break
        }
        case 'response.incomplete': {
          const resp = ev.data.response as UpstreamResponse | undefined
          applyFinalResponse(resp)
          state = 'incomplete'
          incompleteReason = resp?.incomplete_details?.reason ?? 'max_output_tokens'
          break
        }
        case 'response.failed': {
          const resp = ev.data.response as UpstreamResponse | undefined
          state = 'failed'
          errorMessage = resp?.error?.message ?? '生成失败'
          break
        }
        case 'error':
          state = 'failed'
          errorMessage = str(ev.data.message) || '生成失败'
          break
        default:
          break
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
    annotations,
    usage,
    incompleteReason,
    errorMessage,
    errorType,
    errorCode,
    httpStatus,
    upstreamResponseId,
    persistEmit,
  })
}
