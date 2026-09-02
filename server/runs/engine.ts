import { and, eq } from 'drizzle-orm'
import type {
  AssistantPhase,
  ContentPart,
  MessageUsage,
  ModelParams,
  ProcessStep,
  SearchAction,
  UrlCitation,
} from '@shared/types/domain'
import { RUN_EVENT_TYPE } from '@shared/types/events'
import { isReasoningEnabled } from '@shared/util/reasoning'
import {
  appendReasoningSummaryDelta,
  appendReasoningTextDelta,
} from '@shared/util/reasoningSummary'
import {
  isSearchCallItem,
  isXSearchActionType,
  mergeSearchAction,
  searchActionFromItem,
  searchCallIdFromEvent,
  xSearchActionFromToolInput,
} from '@shared/util/searchActivity'
import { db } from '../db/client'
import { runEvents, runs } from '../db/schema'
import { providerClientFromRow } from '../provider/client'
import { UpstreamResponseLatencyTracker } from '../provider/response-timing'
import { UpstreamError } from '../provider/errors'
import type { ReasoningReplayContextV1 } from '../provider/reasoning-replay'
import {
  classifyResponsesTerminal,
  type ResponsesTerminalState,
} from '../provider/responses-terminal'
import type { UpstreamOutputItem, UpstreamResponse } from '../provider/upstream-types'
import { runEmitter } from './emitter'
import {
  collectProviderOpaqueStrings,
  redactProviderOpaqueContent,
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

interface MutableReasoningStep {
  kind: 'reasoning'
  id: string
  summaryText: string
  summaryPartKey: string | null
  rawText: string
  rawPartKey: string | null
}

interface MutableCommentaryStep {
  kind: 'commentary'
  id: string
  text: string
}

interface MutableSearchStep {
  kind: 'search'
  id: string
  action: SearchAction | null
}

type MutableProcessStep = MutableReasoningStep | MutableCommentaryStep | MutableSearchStep

interface MutableAnswerPart {
  id: string
  text: string
  annotations: UrlCitation[]
  phase?: AssistantPhase
}

/** 驱动单个 run：流式调用上游 → 逐事件持久化到 run_events + 发射 → 终结。 */
export async function runEngine(ctx: EngineContext): Promise<void> {
  // 既包含历史请求密文，也持续吸收本轮 added/done/terminal 中出现的新版本，
  // 以防兼容上游稍后的错误消息回显任一 opaque 值。
  const sensitiveProviderContent = new Set(collectProviderOpaqueStrings(ctx.body))
  let seq = 0
  const persistEmit = (type: string, data: Record<string, unknown>, observedAt?: Date): number => {
    collectProviderOpaqueStrings(data).forEach((value) => sensitiveProviderContent.add(value))
    // 所有落库/浏览器事件共用唯一净化入口；原始上游对象仍留给终态校准和私有提取。
    const sanitizedData = sanitizeEventData(type, data, [...sensitiveProviderContent])
    const sequenceNumber = seq++
    db.insert(runEvents)
      .values({
        runId: ctx.run.id,
        sequenceNumber,
        type,
        data: sanitizedData,
        ...(observedAt ? { createdAt: observedAt } : {}),
      })
      .run()
    db.update(runs).set({ lastSequenceNumber: sequenceNumber }).where(eq(runs.id, ctx.run.id)).run()
    runEmitter.emit({ runId: ctx.run.id, sequenceNumber, type, data: sanitizedData })
    return sequenceNumber
  }

  const startedAt = new Date()
  const upstreamResponseTiming = new UpstreamResponseLatencyTracker()
  persistEmit(RUN_EVENT_TYPE.created, {
    runId: ctx.run.id,
    conversationId: ctx.conversation.id,
    assistantMessageId: ctx.assistantMessage.id,
    startedAt: startedAt.getTime(),
    reasoningEnabled: isReasoningEnabled(ctx.model, ctx.run.requestParams as ModelParams | null),
  })
  db.update(runs).set({ state: 'running', startedAt }).where(eq(runs.id, ctx.run.id)).run()

  let text = ''
  const mutableProcessSteps: MutableProcessStep[] = []
  let authoritativeProcessSteps: ProcessStep[] | null = null
  const reasoningStepsById = new Map<string, MutableReasoningStep>()
  const commentaryStepsByItemId = new Map<string, MutableCommentaryStep>()
  const searchStepsByCallId = new Map<string, MutableSearchStep>()
  const messagePhaseByItemId = new Map<string, AssistantPhase>()
  const observedOutputItemIds = new Set<string>()
  const answerParts: MutableAnswerPart[] = []
  const answerPartsById = new Map<string, MutableAnswerPart>()
  let authoritativeAnswerContent: ContentPart[] | null = null
  let answerStarted = false
  let rawReasoningObserved = false
  let reasoningSummaryObserved = false
  let provisionalRawAnswerItemId: string | null = null
  let provisionalRawAnswerFirstDeltaAt: Date | null = null
  let provisionalRawAnswerFirstDeltaData: Record<string, unknown> | null = null
  let liveReasoningStartedAt: Date | null = null
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
  let providerReplayContext: ReasoningReplayContextV1 | null = null
  let refusalObserved = false
  let discardPartialOutput = false
  let receivedTerminalEvent = false
  const finalImages = new Map<
    string,
    { attachmentId: string; revisedPrompt: string | null; contentPart: ContentPart }
  >()
  const imageContentParts: ContentPart[] = []
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

  const processStepIdFromEvent = (data: Record<string, unknown>, fallback: string): string =>
    str(data.item_id) ||
    (num(data.output_index) === null ? fallback : `output-${num(data.output_index)}`)

  const ensureReasoningStep = (id: string): MutableReasoningStep => {
    const existing = reasoningStepsById.get(id)
    if (existing) return existing
    const step: MutableReasoningStep = {
      kind: 'reasoning',
      id,
      summaryText: '',
      summaryPartKey: null,
      rawText: '',
      rawPartKey: null,
    }
    reasoningStepsById.set(id, step)
    mutableProcessSteps.push(step)
    return step
  }

  const ensureCommentaryStep = (itemId: string): MutableCommentaryStep => {
    const existing = commentaryStepsByItemId.get(itemId)
    if (existing) return existing
    const step: MutableCommentaryStep = { kind: 'commentary', id: itemId, text: '' }
    commentaryStepsByItemId.set(itemId, step)
    mutableProcessSteps.push(step)
    return step
  }

  const ensureAnswerPart = (data: Record<string, unknown>): MutableAnswerPart => {
    const id = processStepIdFromEvent(data, 'answer')
    const existing = answerPartsById.get(id)
    if (existing) return existing
    const phase = messagePhaseByItemId.get(str(data.item_id))
    const part: MutableAnswerPart = {
      id,
      text: '',
      annotations: [],
      ...(phase ? { phase } : {}),
    }
    answerPartsById.set(id, part)
    answerParts.push(part)
    return part
  }

  const recordSearchItem = (item: unknown, fallbackId: string): void => {
    if (!isSearchCallItem(item)) return
    const callId = str(item.id) || fallbackId
    if (!callId) return
    let step = searchStepsByCallId.get(callId)
    if (!step) {
      step = { kind: 'search', id: callId, action: null }
      searchStepsByCallId.set(callId, step)
      mutableProcessSteps.push(step)
    }
    // 同一次调用会被上报多次（added 常常只有类型），只接受信息量不减少的覆盖。
    step.action = mergeSearchAction(step.action, searchActionFromItem(item))
  }

  // summary 与 raw reasoning_text 是两条独立通道。任一摘要出现后全局压制 raw，
  // 与升级前的策略一致，同时仍按 reasoning item 保留多个过程节点。
  const collectProcessSteps = (): ProcessStep[] => {
    if (authoritativeProcessSteps !== null) return authoritativeProcessSteps
    const hasSummary = mutableProcessSteps.some(
      (step) => step.kind === 'reasoning' && Boolean(step.summaryText),
    )
    return mutableProcessSteps.flatMap((step): ProcessStep[] => {
      if (step.kind === 'reasoning') {
        const reasoningText = hasSummary ? step.summaryText : step.rawText
        return reasoningText ? [{ kind: 'reasoning', text: reasoningText }] : []
      }
      if (step.kind === 'commentary') {
        return step.text ? [{ kind: 'commentary', text: step.text }] : []
      }
      return step.action ? [{ kind: 'search', action: step.action }] : []
    })
  }

  const collectAnswerContent = (): ContentPart[] =>
    answerParts
      .filter((part) => part.text || part.annotations.length > 0)
      .map((part) => ({
        type: 'output_text',
        text: part.text,
        ...(part.annotations.length ? { annotations: part.annotations } : {}),
        ...(part.phase ? { phase: part.phase } : {}),
      }))

  const reclassifyProvisionalRawAnswer = (): void => {
    const itemId = provisionalRawAnswerItemId
    if (!itemId) return

    const answerPart = answerPartsById.get(itemId)
    const commentaryStep = ensureCommentaryStep(itemId)
    if (answerPart) {
      commentaryStep.text += answerPart.text
      answerPartsById.delete(itemId)
      const partIndex = answerParts.indexOf(answerPart)
      if (partIndex >= 0) answerParts.splice(partIndex, 1)
    }
    messagePhaseByItemId.set(itemId, 'commentary')
    text = answerParts.map((part) => part.text).join('')
    annotations = answerParts.flatMap((part) => part.annotations)

    answerStarted = false
    provisionalRawAnswerItemId = null
    provisionalRawAnswerFirstDeltaAt = null
    provisionalRawAnswerFirstDeltaData = null
    // run_events 保持 append-only；候选 delta 尚未下发，这条事件会把完整进展
    // 原子加入过程轨，不产生“先进入正文、随后撤回”的可见跳动。
    persistEmit(RUN_EVENT_TYPE.outputItemReclassified, {
      itemId,
      phase: 'commentary',
      commentaryText: commentaryStep.text,
      answerText: text,
      annotations,
    })
  }

  const commitProvisionalRawFinalAnswer = (): void => {
    const itemId = provisionalRawAnswerItemId
    if (!itemId) return
    const answerPart = answerPartsById.get(itemId)
    const firstDeltaAt = provisionalRawAnswerFirstDeltaAt
    const firstDeltaData = provisionalRawAnswerFirstDeltaData
    if (answerPart?.text && firstDeltaAt && firstDeltaData) {
      answerStarted = true
      const reasoningDurationMs = liveReasoningStartedAt
        ? Math.max(0, firstDeltaAt.getTime() - liveReasoningStartedAt.getTime())
        : null
      persistEmit(
        RUN_EVENT_TYPE.answerStarted,
        {
          itemId,
          ...(num(firstDeltaData.output_index) !== null
            ? { outputIndex: num(firstDeltaData.output_index) }
            : {}),
          ...(reasoningDurationMs !== null ? { reasoningDurationMs } : {}),
        },
        firstDeltaAt,
      )
      // 兼容网关直到 output_item.done 才给可信 phase。候选期间不下发 delta；
      // 确认真正终答后用一条聚合 delta 原子呈现，避免 commentary 闪进正文。
      persistEmit(
        'response.output_text.delta',
        { ...firstDeltaData, delta: answerPart.text },
        firstDeltaAt,
      )
    }
    provisionalRawAnswerItemId = null
    provisionalRawAnswerFirstDeltaAt = null
    provisionalRawAnswerFirstDeltaData = null
  }

  const applyFinalResponse = (response: UpstreamResponse | undefined): void => {
    const currentContent = authoritativeAnswerContent ?? collectAnswerContent()
    const reconciled = reconcileFinalResponse(
      {
        text,
        content: currentContent,
        processSteps: collectProcessSteps(),
        annotations,
        usage,
        upstreamResponseId,
      },
      response,
      {
        observedOutputItemIds: [...observedOutputItemIds],
        messagePhaseByItemId,
        searchActionByItemId: new Map(
          [...searchStepsByCallId].flatMap(([id, step]) =>
            step.action ? [[id, step.action] as const] : [],
          ),
        ),
      },
    )
    text = reconciled.text
    authoritativeAnswerContent = reconciled.content
    authoritativeProcessSteps = reconciled.processSteps
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
    providerReplayContext = buildReasoningReplayContext({
      runId: ctx.run.id,
      terminalState,
      model: ctx.model,
      provider: ctx.provider,
      requestParams: ctx.run.requestParams as ModelParams | null,
      response,
      warn: (message) => console.warn(message),
    })
  }

  const handleTerminalResponse = (
    eventState: ResponsesTerminalState,
    response: UpstreamResponse | undefined,
  ) => {
    // failed 终态也可能携带最终 usage / response id，不能只解析成功终态。
    applyFinalResponse(response)

    const terminal = classifyResponsesTerminal(response, {
      eventState,
      refusalObserved,
    })

    if (terminal.state === 'failed') {
      const terminalErrorMessage =
        terminal.errorType === 'refusal'
          ? '模型拒绝了此请求，请调整内容后重试。'
          : terminal.errorType === 'content_filter'
            ? '上游内容过滤器终止了生成，请调整内容后重试。'
            : redactProviderOpaqueContent(response?.error?.message ?? '生成失败', [
                ...sensitiveProviderContent,
                ...collectProviderOpaqueStrings(response),
              ])
      providerReplayContext = null
      return { terminal, errorMessage: terminalErrorMessage }
    }

    saveResponseImages(response)
    captureReasoningReplayContext(terminal.state, response)
    return { terminal, errorMessage: null }
  }

  try {
    const client = providerClientFromRow(ctx.provider, upstreamResponseTiming)
    const stream = streamResponseWithFallback({
      body: ctx.body,
      openStream: (body) => client.createResponseStream(body, ctx.abortController.signal),
      onFallback: (fallback) => {
        console.warn(`run ${ctx.run.id} 在首个上游事件前执行降级重试: ${fallback}`)
      },
    })
    for await (const ev of stream) {
      const eventObservedAt = new Date()
      if (ev.type === 'response.image_generation_call.partial_image') {
        savePartialImage(ev.data)
        continue
      }

      if (
        liveReasoningStartedAt === null &&
        (ev.type === 'response.created' ||
          ev.type === 'response.in_progress' ||
          ev.type === 'response.reasoning_summary_text.delta')
      ) {
        liveReasoningStartedAt = eventObservedAt
      }

      if (ev.type === 'response.output_item.done' && provisionalRawAnswerItemId) {
        const item = ev.data.item
        const itemId = isRecord(item) ? str(item.id) || str(ev.data.item_id) : ''
        if (itemId === provisionalRawAnswerItemId) {
          if (isRecord(item) && item.phase === 'commentary') {
            reclassifyProvisionalRawAnswer()
          } else {
            commitProvisionalRawFinalAnswer()
          }
        }
      }

      const rawProvisionalDelta =
        ev.type === 'response.output_text.delta' &&
        Boolean(provisionalRawAnswerItemId) &&
        str(ev.data.item_id) === provisionalRawAnswerItemId
      if (rawProvisionalDelta && provisionalRawAnswerFirstDeltaAt === null) {
        provisionalRawAnswerFirstDeltaAt = eventObservedAt
        provisionalRawAnswerFirstDeltaData = ev.data
      }

      if (
        ev.type === 'response.output_text.delta' &&
        !rawProvisionalDelta &&
        !commentaryStepsByItemId.has(str(ev.data.item_id)) &&
        !answerStarted
      ) {
        answerStarted = true
        const itemId = str(ev.data.item_id)
        const reasoningDurationMs = liveReasoningStartedAt
          ? Math.max(0, eventObservedAt.getTime() - liveReasoningStartedAt.getTime())
          : null
        persistEmit(
          RUN_EVENT_TYPE.answerStarted,
          {
            ...(itemId ? { itemId } : {}),
            ...(num(ev.data.output_index) !== null
              ? { outputIndex: num(ev.data.output_index) }
              : {}),
            ...(reasoningDurationMs !== null ? { reasoningDurationMs } : {}),
          },
          eventObservedAt,
        )
      }
      if (!rawProvisionalDelta) persistEmit(ev.type, ev.data, eventObservedAt)
      switch (ev.type) {
        case 'response.output_item.added': {
          const item = ev.data.item
          if (isRecord(item)) {
            const itemId = str(item.id) || str(ev.data.item_id)
            const outputIndex = num(ev.data.output_index)
            if (
              itemId &&
              (item.type === 'reasoning' || item.type === 'message' || isSearchCallItem(item))
            ) {
              observedOutputItemIds.add(itemId)
            }
            if (item.type === 'reasoning') {
              ensureReasoningStep(
                itemId || (outputIndex === null ? 'reasoning' : `output-${outputIndex}`),
              )
            } else if (item.type === 'message' && itemId) {
              if (item.phase === 'commentary') {
                ensureCommentaryStep(itemId)
                messagePhaseByItemId.set(itemId, 'commentary')
              } else if (item.phase === 'final_answer') {
                messagePhaseByItemId.set(itemId, 'final_answer')
                if (rawReasoningObserved && !reasoningSummaryObserved) {
                  provisionalRawAnswerItemId = itemId
                }
              }
            }
          }
          // xAI 旧实现的 web_search_call 可能一出现即 completed 且带 arguments；
          // x_search 的 custom_tool_call 首帧只有工具名，都在这里先建立顺序占位。
          recordSearchItem(item, searchCallIdFromEvent(ev.data))
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
          if (isRecord(item) && item.type === 'message' && item.phase === 'final_answer') {
            const itemId = str(item.id) || str(ev.data.item_id)
            if (itemId) {
              messagePhaseByItemId.set(itemId, 'final_answer')
              const answerPart = answerPartsById.get(itemId)
              if (answerPart) answerPart.phase = 'final_answer'
            }
          }
          recordSearchItem(item, searchCallIdFromEvent(ev.data))
          if (isImageGenerationItem(item)) {
            emitCompletedImage(
              item,
              str(ev.data.output_index) || 'image',
              num(ev.data.output_index),
            )
          }
          break
        }
        // x_search 的参数走 custom_tool_call_input，比 output_item.done 早到；
        // 被取消/中断时它可能是唯一一次带回查询词的机会。
        case 'response.custom_tool_call_input.done': {
          const callId = searchCallIdFromEvent(ev.data)
          const pending = callId ? searchStepsByCallId.get(callId) : undefined
          if (pending?.action && isXSearchActionType(pending.action.type)) {
            pending.action = mergeSearchAction(
              pending.action,
              xSearchActionFromToolInput(pending.action.type, ev.data.input),
            )
          }
          break
        }
        case 'response.output_text.delta': {
          const commentaryStep = commentaryStepsByItemId.get(str(ev.data.item_id))
          if (commentaryStep) {
            commentaryStep.text += str(ev.data.delta)
          } else {
            const answerPart = ensureAnswerPart(ev.data)
            answerPart.text += str(ev.data.delta)
            text += str(ev.data.delta)
          }
          break
        }
        case 'response.refusal.delta':
        case 'response.refusal.done':
          refusalObserved = true
          break
        case 'response.reasoning_summary_text.delta': {
          reasoningSummaryObserved = true
          const reasoningStep = ensureReasoningStep(processStepIdFromEvent(ev.data, 'reasoning'))
          const accumulatedReasoning = appendReasoningSummaryDelta(
            { text: reasoningStep.summaryText, partKey: reasoningStep.summaryPartKey },
            ev.data,
          )
          reasoningStep.summaryText = accumulatedReasoning.text
          reasoningStep.summaryPartKey = accumulatedReasoning.partKey
          break
        }
        case 'response.reasoning_text.delta': {
          rawReasoningObserved = true
          const reasoningStep = ensureReasoningStep(processStepIdFromEvent(ev.data, 'reasoning'))
          const accumulatedReasoning = appendReasoningTextDelta(
            { text: reasoningStep.rawText, partKey: reasoningStep.rawPartKey },
            ev.data,
          )
          reasoningStep.rawText = accumulatedReasoning.text
          reasoningStep.rawPartKey = accumulatedReasoning.partKey
          break
        }
        case 'response.output_text.annotation.added': {
          if (commentaryStepsByItemId.has(str(ev.data.item_id))) break
          pushCitation(annotations, ev.data.annotation)
          const answerPart = ensureAnswerPart(ev.data)
          pushCitation(answerPart.annotations, ev.data.annotation)
          break
        }
        case 'response.completed':
        case 'response.incomplete':
        case 'response.failed': {
          receivedTerminalEvent = true
          const resp = ev.data.response as UpstreamResponse | undefined
          const eventState: ResponsesTerminalState =
            ev.type === 'response.completed'
              ? 'completed'
              : ev.type === 'response.incomplete'
                ? 'incomplete'
                : 'failed'
          const terminalResult = handleTerminalResponse(eventState, resp)
          state = terminalResult.terminal.state
          incompleteReason = terminalResult.terminal.incompleteReason
          errorType = terminalResult.terminal.errorType
          errorCode = terminalResult.terminal.errorCode
          discardPartialOutput = terminalResult.terminal.discardPartialOutput
          errorMessage = terminalResult.errorMessage
          break
        }
        case 'error':
          receivedTerminalEvent = true
          state = 'failed'
          errorType = 'response_error'
          errorCode = str(ev.data.code) || null
          errorMessage = redactProviderOpaqueContent(str(ev.data.message) || '生成失败', [
            ...sensitiveProviderContent,
            ...collectProviderOpaqueStrings(ev.data),
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
      errorMessage = redactProviderOpaqueContent(
        ue?.message ?? (e instanceof Error ? e.message : '生成失败'),
        [...sensitiveProviderContent],
      )
      errorType = ue?.type
        ? redactProviderOpaqueContent(ue.type, [...sensitiveProviderContent])
        : null
      errorCode = ue?.code
        ? redactProviderOpaqueContent(ue.code, [...sensitiveProviderContent])
        : null
      httpStatus = ue?.status ?? null
    }
  }

  if (discardPartialOutput) {
    text = ''
    authoritativeAnswerContent = []
    authoritativeProcessSteps = []
    mutableProcessSteps.length = 0
    answerParts.length = 0
    annotations = []
    reasoningStepsById.clear()
    commentaryStepsByItemId.clear()
    searchStepsByCallId.clear()
    answerPartsById.clear()
    providerReplayContext = null
    cleanupPartialImages()
    removeGeneratedImageAttachments([...finalImages.values()].map((image) => image.attachmentId))
    finalImages.clear()
    imageContentParts.length = 0
  }

  const answerContent = authoritativeAnswerContent ?? collectAnswerContent()
  const finalContentParts: ContentPart[] = [
    ...(answerContent.length > 0
      ? answerContent
      : text
        ? [
            {
              type: 'output_text' as const,
              text,
              ...(annotations.length ? { annotations } : {}),
            },
          ]
        : []),
    ...imageContentParts,
  ]

  await finalizeRun({
    run: ctx.run,
    assistantMessage: ctx.assistantMessage,
    conversation: ctx.conversation,
    model: ctx.model,
    provider: ctx.provider,
    state,
    text,
    processSteps: collectProcessSteps(),
    annotations,
    usage,
    incompleteReason,
    errorMessage,
    errorType,
    errorCode,
    httpStatus,
    discardPartialOutput,
    upstreamResponseId,
    providerReplayContext,
    startedAt,
    upstreamResponseLatencyMs: upstreamResponseTiming.latencyMs,
    content: discardPartialOutput ? [] : finalContentParts,
    persistEmit,
  })

  if ((state === 'completed' || state === 'incomplete') && imageContentParts.length) {
    cleanupPartialImages()
  }
}
