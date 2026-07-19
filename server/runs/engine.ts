import { and, eq } from 'drizzle-orm'
import type {
  ContentPart,
  MessageUsage,
  ModelParams,
  UrlCitation,
  WebSearchAction,
} from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { isReasoningEnabled } from '@shared/util/reasoning'
import { appendReasoningSummaryDelta } from '@shared/util/reasoningSummary'
import {
  isWebSearchCallItem,
  webSearchActionFromItem,
  webSearchCallIdFromEvent,
} from '@shared/util/webSearchActivity'
import { db } from '../db/client'
import { runEvents, runs } from '../db/schema'
import { providerClientFromRow } from '../provider/client'
import { UpstreamError } from '../provider/errors'
import type { ReasoningReplayContextV1 } from '../provider/reasoning-replay'
import type { UpstreamOutputItem, UpstreamResponse } from '../provider/upstream-types'
import { runEmitter } from './emitter'
import {
  collectEncryptedContentStrings,
  redactEncryptedContent,
  sanitizeEventData,
} from './event-sanitize'
import { reconcileFinalResponse } from './final-response'
import { finalizeRun } from './finalize'
import { removeGeneratedImageAttachments, storeGeneratedImageAttachment } from './generated-images'
import { buildReasoningReplayContext } from './reasoning-replay-capture'
import { streamResponseWithFallback } from './response-stream-fallback'
import type { EngineContext } from './types'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

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

function imageItemId(item: Record<string, unknown>): string | null {
  return str(item.id) || str(item.item_id) || null
}

function isImageGenerationItem(item: unknown): item is Record<string, unknown> {
  return isRecord(item) && item.type === 'image_generation_call'
}

function responseImageItems(response: UpstreamResponse | undefined): UpstreamOutputItem[] {
  return (response?.output ?? []).filter((item) => item.type === 'image_generation_call')
}

interface ImageGenerationSlot {
  generationId: string
  callId: string | null
  index: number
  outputIndex: number | null
}

/** 驱动单个 run：流式调用上游 → 逐事件持久化到 run_events + 发射 → 终结。 */
export async function runEngine(ctx: EngineContext): Promise<void> {
  // 既包含历史请求密文，也持续吸收本轮 added/done/terminal 中出现的新版本，
  // 以防兼容上游稍后的错误消息回显任一 opaque 值。
  const sensitiveEncryptedContent = new Set(collectEncryptedContentStrings(ctx.body))
  let seq = 0
  const persistEmit = (type: string, data: Record<string, unknown>): number => {
    collectEncryptedContentStrings(data).forEach((value) => sensitiveEncryptedContent.add(value))
    // 所有落库/浏览器事件共用唯一净化入口；原始上游对象仍留给终态校准和私有提取。
    const sanitizedData = sanitizeEventData(type, data, [...sensitiveEncryptedContent])
    const sequenceNumber = seq++
    db.insert(runEvents)
      .values({ runId: ctx.run.id, sequenceNumber, type, data: sanitizedData })
      .run()
    db.update(runs).set({ lastSequenceNumber: sequenceNumber }).where(eq(runs.id, ctx.run.id)).run()
    runEmitter.emit({ runId: ctx.run.id, sequenceNumber, type, data: sanitizedData })
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
  let reasoningPartKey: string | null = null
  let annotations: UrlCitation[] = []
  let usage: MessageUsage = {
    inputTokens: 0,
    cacheWriteTokens: 0,
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
  let reasoningReplayContext: ReasoningReplayContextV1 | null = null
  let receivedTerminalEvent = false
  const finalContentParts: ContentPart[] = []
  const finalImages = new Map<
    string,
    { attachmentId: string; revisedPrompt: string | null; contentPart: ContentPart }
  >()
  const imageContentParts: ContentPart[] = []
  // web_search 动作按调用首次出现的顺序累积（Map 保序）；查询词等细节要等
  // output_item.done / 终态 output 才出现，null 表示调用已见但动作暂不可解析。
  const webSearchActionsByCallId = new Map<string, WebSearchAction | null>()
  const imageSlots = new Map<string, ImageGenerationSlot>()
  const imageSlotOrder: ImageGenerationSlot[] = []
  const partialImageAttachmentIds = new Set<string>()

  const ensureImageSlot = ({
    callId,
    outputIndex,
    fallback,
  }: {
    callId?: string | null
    outputIndex?: number | null
    fallback?: string | null
  }): ImageGenerationSlot => {
    const normalizedCallId = callId || null
    const normalizedOutputIndex = outputIndex ?? null
    const outputKey = normalizedOutputIndex === null ? null : `output-${normalizedOutputIndex}`
    const fallbackKey = fallback || null
    const existing =
      (normalizedCallId ? imageSlots.get(normalizedCallId) : undefined) ??
      (outputKey ? imageSlots.get(outputKey) : undefined) ??
      (fallbackKey ? imageSlots.get(fallbackKey) : undefined)

    if (existing) {
      if (normalizedCallId) {
        existing.callId = existing.callId ?? normalizedCallId
        imageSlots.set(normalizedCallId, existing)
      }
      if (outputKey) {
        existing.outputIndex = existing.outputIndex ?? normalizedOutputIndex
        imageSlots.set(outputKey, existing)
      }
      return existing
    }

    const index = imageSlotOrder.length
    const generationId = normalizedCallId || fallbackKey || `image-${index}`
    const slot: ImageGenerationSlot = {
      generationId,
      callId: normalizedCallId,
      index,
      outputIndex: normalizedOutputIndex,
    }
    imageSlotOrder.push(slot)
    imageSlots.set(generationId, slot)
    if (normalizedCallId) imageSlots.set(normalizedCallId, slot)
    if (outputKey) imageSlots.set(outputKey, slot)
    return slot
  }

  const imageSlotPayload = (
    slot: ImageGenerationSlot,
    data: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    generationId: slot.generationId,
    callId: slot.callId,
    index: slot.index,
    outputIndex: slot.outputIndex,
    ...data,
  })

  const markPartialAttachmentEventsCleaned = (): void => {
    if (!partialImageAttachmentIds.size) return
    const rows = db
      .select({ id: runEvents.id, data: runEvents.data })
      .from(runEvents)
      .where(and(eq(runEvents.runId, ctx.run.id), eq(runEvents.type, 'image.generation.partial')))
      .all()

    for (const row of rows) {
      const attachmentId = str(row.data.attachmentId)
      if (!partialImageAttachmentIds.has(attachmentId)) continue
      db.update(runEvents)
        .set({
          data: {
            ...row.data,
            attachmentId: null,
            attachmentDeleted: true,
          },
        })
        .where(eq(runEvents.id, row.id))
        .run()
    }
  }

  const cleanupPartialImages = (): void => {
    if (!partialImageAttachmentIds.size) return
    try {
      markPartialAttachmentEventsCleaned()
      removeGeneratedImageAttachments([...partialImageAttachmentIds])
      partialImageAttachmentIds.clear()
    } catch (e) {
      console.warn('清理生图半成品失败:', e)
    }
  }

  const recordWebSearchItem = (item: unknown, fallbackId: string): void => {
    if (!isWebSearchCallItem(item)) return
    const callId = str(item.id) || fallbackId
    if (!callId) return
    const action = webSearchActionFromItem(item)
    // 只允许「无动作 → 有动作」的补全，避免终态回读把已解析结果冲掉。
    if (!webSearchActionsByCallId.has(callId) || action) {
      webSearchActionsByCallId.set(callId, action)
    }
  }

  /** 终态 output 兜底：覆盖丢帧或不发 lifecycle 事件的兼容上游。 */
  const recordResponseWebSearchItems = (response: UpstreamResponse | undefined): void => {
    ;(response?.output ?? []).forEach((item, index) => {
      recordWebSearchItem(item, `response-web-search-${index}`)
    })
  }

  const collectWebSearchActions = (): WebSearchAction[] =>
    [...webSearchActionsByCallId.values()].filter(
      (action): action is WebSearchAction => action !== null,
    )

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

  const savePartialImage = (data: Record<string, unknown>): void => {
    const b64 = str(data.partial_image_b64)
    if (!b64) return
    const partialIndex =
      typeof data.partial_image_index === 'number' ? data.partial_image_index : null
    const callId = str(data.item_id) || str(data.id) || null
    const outputIndex = num(data.output_index)
    const slot = ensureImageSlot({ callId, outputIndex })
    try {
      const stored = storeGeneratedImageAttachment({
        userId: ctx.run.userId,
        messageId: ctx.assistantMessage.id,
        b64Json: b64,
        filenamePrefix:
          partialIndex === null
            ? `partial-image-${slot.index + 1}`
            : `partial-image-${slot.index + 1}-${partialIndex}`,
      })
      partialImageAttachmentIds.add(stored.attachmentId)
      persistEmit(
        'image.generation.partial',
        imageSlotPayload(slot, {
          attachmentId: stored.attachmentId,
          partialIndex,
        }),
      )
    } catch (e) {
      console.warn('保存生图半成品失败:', e)
    }
  }

  const saveFinalImage = (
    item: Record<string, unknown>,
    slot: ImageGenerationSlot,
  ): { attachmentId: string; revisedPrompt: string | null; isNew: boolean } | null => {
    const b64 = str(item.result)
    if (!b64) return null
    const existing = finalImages.get(slot.generationId)
    if (existing) {
      return {
        attachmentId: existing.attachmentId,
        revisedPrompt: existing.revisedPrompt,
        isNew: false,
      }
    }

    const revisedPrompt = str(item.revised_prompt) || null
    const stored = storeGeneratedImageAttachment({
      userId: ctx.run.userId,
      messageId: ctx.assistantMessage.id,
      b64Json: b64,
    })
    const contentPart: ContentPart = {
      type: 'image_result',
      attachment_id: stored.attachmentId,
      ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {}),
    }
    finalImages.set(slot.generationId, {
      attachmentId: stored.attachmentId,
      revisedPrompt,
      contentPart,
    })
    imageContentParts.push(contentPart)
    return { attachmentId: stored.attachmentId, revisedPrompt, isNew: true }
  }

  const emitCompletedImage = (
    item: Record<string, unknown>,
    fallbackId: string,
    outputIndex: number | null = null,
  ): void => {
    const callId = imageItemId(item)
    const slot = ensureImageSlot({ callId, outputIndex, fallback: callId || fallbackId })
    const saved = saveFinalImage(item, slot)
    if (!saved?.isNew) return
    persistEmit(
      'image.generation.completed',
      imageSlotPayload(slot, {
        attachmentId: saved.attachmentId,
        revisedPrompt: saved.revisedPrompt,
      }),
    )
  }

  const saveResponseImages = (response: UpstreamResponse | undefined): void => {
    responseImageItems(response).forEach((item, index) => {
      emitCompletedImage(item as unknown as Record<string, unknown>, `response-${index}`)
    })
  }

  const captureReasoningReplayContext = (
    terminalState: 'completed' | 'incomplete',
    response: UpstreamResponse | undefined,
  ): void => {
    reasoningReplayContext = buildReasoningReplayContext({
      runId: ctx.run.id,
      terminalState,
      model: ctx.model,
      provider: ctx.provider,
      requestParams: ctx.run.requestParams as ModelParams | null,
      response,
      warn: (message) => console.warn(message),
    })
  }

  try {
    const client = providerClientFromRow(ctx.provider)
    const stream = streamResponseWithFallback({
      body: ctx.body,
      openStream: (body) => client.createResponseStream(body, ctx.abortController.signal),
      onFallback: (fallback) => {
        console.warn(`run ${ctx.run.id} 在首个上游事件前执行降级重试: ${fallback}`)
      },
    })
    for await (const ev of stream) {
      if (ev.type === 'response.image_generation_call.partial_image') {
        savePartialImage(ev.data)
        continue
      }

      persistEmit(ev.type, ev.data)
      switch (ev.type) {
        case 'response.output_item.added': {
          const item = ev.data.item
          // xAI 旧实现的 web_search_call 可能一出现即 completed 且带 arguments，这里同样收录。
          recordWebSearchItem(item, webSearchCallIdFromEvent(ev.data))
          if (isImageGenerationItem(item)) {
            const outputIndex = num(ev.data.output_index)
            const callId = imageItemId(item) || str(ev.data.item_id)
            const slot = ensureImageSlot({
              callId,
              outputIndex,
              fallback: callId || (outputIndex === null ? null : `output-${outputIndex}`),
            })
            persistEmit('image.generation.in_progress', imageSlotPayload(slot))
          }
          break
        }
        case 'response.image_generation_call.in_progress':
        case 'response.image_generation_call.generating': {
          const slot = ensureImageSlot({
            callId: str(ev.data.item_id) || str(ev.data.id),
            outputIndex: num(ev.data.output_index),
          })
          persistEmit('image.generation.in_progress', imageSlotPayload(slot))
          break
        }
        case 'response.output_item.done': {
          const item = ev.data.item
          recordWebSearchItem(item, webSearchCallIdFromEvent(ev.data))
          if (isImageGenerationItem(item)) {
            emitCompletedImage(
              item,
              str(ev.data.output_index) || 'image',
              num(ev.data.output_index),
            )
          }
          break
        }
        case 'response.output_text.delta':
          text += str(ev.data.delta)
          break
        case 'response.reasoning_summary_text.delta': {
          const accumulatedReasoning = appendReasoningSummaryDelta(
            { text: reasoning, partKey: reasoningPartKey },
            ev.data,
          )
          reasoning = accumulatedReasoning.text
          reasoningPartKey = accumulatedReasoning.partKey
          break
        }
        case 'response.output_text.annotation.added':
          pushCitation(annotations, ev.data.annotation)
          break
        case 'response.completed': {
          receivedTerminalEvent = true
          const resp = ev.data.response as UpstreamResponse | undefined
          applyFinalResponse(resp)
          saveResponseImages(resp)
          recordResponseWebSearchItems(resp)
          state = 'completed'
          captureReasoningReplayContext(state, resp)
          break
        }
        case 'response.incomplete': {
          receivedTerminalEvent = true
          const resp = ev.data.response as UpstreamResponse | undefined
          applyFinalResponse(resp)
          saveResponseImages(resp)
          recordResponseWebSearchItems(resp)
          state = 'incomplete'
          incompleteReason = resp?.incomplete_details?.reason ?? 'max_output_tokens'
          captureReasoningReplayContext(state, resp)
          break
        }
        case 'response.failed': {
          receivedTerminalEvent = true
          const resp = ev.data.response as UpstreamResponse | undefined
          state = 'failed'
          errorMessage = redactEncryptedContent(resp?.error?.message ?? '生成失败', [
            ...sensitiveEncryptedContent,
            ...collectEncryptedContentStrings(resp),
          ])
          break
        }
        case 'error':
          receivedTerminalEvent = true
          state = 'failed'
          errorMessage = redactEncryptedContent(str(ev.data.message) || '生成失败', [
            ...sensitiveEncryptedContent,
            ...collectEncryptedContentStrings(ev.data),
          ])
          break
        default:
          break
      }
    }
    if (!receivedTerminalEvent) {
      if (ctx.abortController.signal.aborted) {
        state = 'canceled'
      } else {
        state = 'failed'
        errorType = 'incomplete_stream'
        errorMessage = '上游响应在终态事件前结束'
      }
    }
  } catch (e) {
    if (ctx.abortController.signal.aborted) {
      state = 'canceled'
    } else {
      const ue = e instanceof UpstreamError ? e : null
      state = 'failed'
      errorMessage = redactEncryptedContent(
        ue?.message ?? (e instanceof Error ? e.message : '生成失败'),
        [...sensitiveEncryptedContent],
      )
      errorType = ue?.type ? redactEncryptedContent(ue.type, [...sensitiveEncryptedContent]) : null
      errorCode = ue?.code ? redactEncryptedContent(ue.code, [...sensitiveEncryptedContent]) : null
      httpStatus = ue?.status ?? null
    }
  }

  if (imageContentParts.length) {
    if (text) {
      finalContentParts.push({
        type: 'output_text',
        text,
        ...(annotations.length ? { annotations } : {}),
      })
    }
    finalContentParts.push(...imageContentParts)
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
    webSearchActions: collectWebSearchActions(),
    incompleteReason,
    errorMessage,
    errorType,
    errorCode,
    httpStatus,
    upstreamResponseId,
    reasoningReplayContext,
    startedAt,
    content: finalContentParts.length ? finalContentParts : undefined,
    persistEmit,
  })

  if ((state === 'completed' || state === 'incomplete') && imageContentParts.length) {
    cleanupPartialImages()
  }
}
