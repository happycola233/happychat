import type {
  ProcessStep,
  SearchAction,
  UrlCitation,
  XSearchActionType,
} from '@shared/types/domain'
import { RUN_EVENT_TYPE, type WireEvent } from '@shared/types/events'
import {
  appendReasoningSummaryDelta,
  appendReasoningTextDelta,
  responseDeltaIdentityKey,
} from '@shared/util/reasoningSummary'
import {
  isSearchActionType,
  isSearchCallItem,
  isXSearchActionType,
  mergeSearchAction,
  searchActionFromItem,
  searchCallIdFromEvent,
  xSearchActionFromToolInput,
} from '@shared/util/searchActivity'

export type LiveStatus =
  | 'streaming'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'canceled'
  | 'interrupted'

export interface LiveImageGeneration {
  id: string
  callId?: string
  index: number
  outputIndex: number | null
  status: 'generating' | 'done'
  attachmentId?: string
  previewAttachmentId?: string
  previewIndex: number | null
  previewUpdatedAt: number | null
  revisedPrompt?: string
  startedAt: number | null
  completedAt: number | null
}

export type LiveSearchCallStatus = 'in_progress' | 'searching' | 'completed'

/**
 * 一次检索工具调用（web_search 或 x_search）的流式状态。检索不是贯穿思考的持续
 * 状态，而是 0~N 个离散调用；web_search 的查询词要等调用完成才出现，x_search 的
 * 动作类型在调用出现时即可确定、参数随 custom_tool_call_input 稍后补齐。
 */
export type LiveProcessStep =
  | { kind: 'reasoning'; id: string; text: string; partKey: string | null }
  | { kind: 'commentary'; id: string; text: string }
  | {
      kind: 'search'
      id: string
      status: LiveSearchCallStatus
      /** 流式细节未到达时可能只有 type，完全无法识别时为 null。 */
      action: SearchAction | null
    }

export type LiveSearchStep = Extract<LiveProcessStep, { kind: 'search' }>

export const hasActiveSearch = (steps: readonly LiveProcessStep[]): boolean =>
  steps.some((step) => step.kind === 'search' && step.status !== 'completed')

/** 持久化消息与分享快照没有流式状态，统一适配成已完成的过程轨。 */
export function liveStepsFromPersisted(steps: ProcessStep[] | null | undefined): LiveProcessStep[] {
  return (steps ?? []).map((step, index): LiveProcessStep => {
    if (step.kind === 'reasoning') {
      return { kind: 'reasoning', id: `saved-reasoning-${index}`, text: step.text, partKey: null }
    }
    if (step.kind === 'commentary') {
      return { kind: 'commentary', id: `saved-commentary-${index}`, text: step.text }
    }
    return {
      kind: 'search',
      id: `saved-search-${index}`,
      status: 'completed',
      action: step.action,
    }
  })
}

export interface LiveMessage {
  text: string
  /** 当前展示的是摘要还是上游明文推理；摘要一旦出现便覆盖并抑制 raw 通道。 */
  reasoningKind: 'summary' | 'raw' | null
  processSteps: LiveProcessStep[]
  answerStarted: boolean
  upstreamStartedAt: number | null
  reasoningDurationMs: number | null
  reasoningEnabled: boolean
  annotations: UrlCitation[]
  status: LiveStatus
  error?: string
  imageStatus?: 'generating' | 'done'
  imageGenerations: LiveImageGeneration[]
  /** 兼容旧 UI 读取；新 UI 使用 imageGenerations。 */
  imageAttachmentId?: string
  imagePreviewAttachmentId?: string
  imagePreviewIndex: number | null
  imagePreviewUpdatedAt: number | null
  imageRevisedPrompt?: string
  imageStartedAt: number | null
}

export const initialLive = (
  upstreamStartedAt: number | null = null,
  reasoningEnabled = false,
): LiveMessage => ({
  text: '',
  reasoningKind: null,
  processSteps: [],
  answerStarted: false,
  upstreamStartedAt,
  reasoningDurationMs: null,
  reasoningEnabled,
  annotations: [],
  status: 'streaming',
  imageGenerations: [],
  imagePreviewIndex: null,
  imagePreviewUpdatedAt: null,
  imageStartedAt: null,
})

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const APPEND_DELTA_TYPES = new Set([
  'response.output_text.delta',
  'response.reasoning_summary_text.delta',
  'response.reasoning_text.delta',
])

function compactAppendEvents(events: WireEvent[]): WireEvent[] {
  const compacted: WireEvent[] = []
  let pendingType: string | null = null
  let pendingKey: string | null = null
  let pendingSeq = -1
  let pendingData: Record<string, unknown> | null = null

  const flushPending = () => {
    if (!pendingType || !pendingData) return
    compacted.push({ type: pendingType, seq: pendingSeq, data: pendingData })
    pendingType = null
    pendingKey = null
    pendingSeq = -1
    pendingData = null
  }

  for (const ev of events) {
    const eventKey = APPEND_DELTA_TYPES.has(ev.type)
      ? responseDeltaIdentityKey(ev.type, ev.data)
      : null
    if (!eventKey) {
      flushPending()
      compacted.push(ev)
      continue
    }

    if (pendingKey === eventKey && pendingData) {
      pendingSeq = ev.seq
      pendingData = { ...ev.data, delta: str(pendingData.delta) + str(ev.data.delta) }
      continue
    }

    flushPending()
    pendingType = ev.type
    pendingKey = eventKey
    pendingSeq = ev.seq
    pendingData = { ...ev.data }
  }

  flushPending()
  return compacted
}

function finalAnnotations(value: unknown, fallback: UrlCitation[]): UrlCitation[] {
  if (!Array.isArray(value)) return fallback
  const next = value.filter(
    (annotation): annotation is UrlCitation =>
      typeof annotation === 'object' &&
      annotation !== null &&
      (annotation as { type?: unknown }).type === 'url_citation' &&
      typeof (annotation as { url?: unknown }).url === 'string' &&
      typeof (annotation as { title?: unknown }).title === 'string' &&
      typeof (annotation as { start_index?: unknown }).start_index === 'number' &&
      typeof (annotation as { end_index?: unknown }).end_index === 'number',
  )
  const unchanged =
    next.length === fallback.length &&
    next.every(
      (annotation, index) =>
        annotation.url === fallback[index]?.url &&
        annotation.title === fallback[index]?.title &&
        annotation.start_index === fallback[index]?.start_index &&
        annotation.end_index === fallback[index]?.end_index,
    )
  return unchanged ? fallback : next
}

interface SearchCallPatch {
  status?: LiveSearchCallStatus
  action?: SearchAction | null
}

function upsertSearchStep(s: LiveMessage, id: string, patch: SearchCallPatch): LiveMessage {
  // 无标识的事件回落到最近一个未完成调用（同图片生成的口径），避免重复建行。
  const index = id
    ? s.processSteps.findIndex((step) => step.kind === 'search' && step.id === id)
    : s.processSteps.findLastIndex((step) => step.kind === 'search' && step.status !== 'completed')
  if (index < 0) {
    const step: LiveSearchStep = {
      kind: 'search',
      id: id || `search-${s.processSteps.length}`,
      status: patch.status ?? 'in_progress',
      action: patch.action ?? null,
    }
    return { ...s, processSteps: [...s.processSteps, step] }
  }
  const existing = s.processSteps[index] as LiveSearchStep
  const next: LiveSearchStep = {
    ...existing,
    // completed 不允许回退（防御事件乱序与续传重放）。
    status: existing.status === 'completed' ? 'completed' : (patch.status ?? existing.status),
    // 同一次调用会被上报多次，只接受信息量不减少的动作覆盖。
    action: mergeSearchAction(existing.action, patch.action ?? null),
  }
  if (next.status === existing.status && next.action === existing.action) return s
  const processSteps = s.processSteps.slice()
  processSteps[index] = next
  return { ...s, processSteps }
}

function reduceSearchItemEvent(s: LiveMessage, ev: WireEvent): LiveMessage {
  const item = ev.data.item
  if (!isSearchCallItem(item)) return s
  const completed = ev.type === 'response.output_item.done' || item.status === 'completed'
  return upsertSearchStep(s, searchCallIdFromEvent(ev.data), {
    ...(completed ? { status: 'completed' as const } : {}),
    action: searchActionFromItem(item),
  })
}

/**
 * x_search 的参数走独立的 custom_tool_call_input 事件，比 output_item.done 早到；
 * 动作类型已由 output_item.added 建立，这里只负责把查询词等细节补上。
 */
function reduceXSearchInputEvent(s: LiveMessage, ev: WireEvent): LiveMessage {
  const id = searchCallIdFromEvent(ev.data)
  const pending = id
    ? (
        s.processSteps.find((step) => step.kind === 'search' && step.id === id) as
          | LiveSearchStep
          | undefined
      )?.action
    : null
  if (!pending || !isXSearchActionType(pending.type)) return s
  const type: XSearchActionType = pending.type
  return upsertSearchStep(s, id, { action: xSearchActionFromToolInput(type, ev.data.input) })
}

/**
 * 终态收口：结束所有仍在进行的调用，并丢弃始终没解析出动作的占位调用，
 * 与刷新后读到的持久化 processSteps 保持同一份内容。
 */
function settleProcessSteps(steps: LiveProcessStep[]): LiveProcessStep[] {
  const settled = steps
    .filter((step) => step.kind !== 'search' || step.action !== null)
    .map((step) =>
      step.kind !== 'search' || step.status === 'completed'
        ? step
        : { ...step, status: 'completed' as const },
    )
  return settled.length === steps.length && settled.every((step, index) => step === steps[index])
    ? steps
    : settled
}

function isSearchActionShape(value: unknown): value is SearchAction {
  if (typeof value !== 'object' || value === null) return false
  return isSearchActionType((value as { type?: unknown }).type)
}

function isProcessStepShape(value: unknown): value is ProcessStep {
  if (typeof value !== 'object' || value === null) return false
  const step = value as { kind?: unknown; text?: unknown; action?: unknown }
  if (step.kind === 'reasoning' || step.kind === 'commentary') return typeof step.text === 'string'
  return step.kind === 'search' && isSearchActionShape(step.action)
}

/** run.done 携带的终态过程轨是权威值；一致时保留行身份，避免重播入场动画。 */
function finalProcessSteps(steps: LiveProcessStep[], finalSteps: unknown): LiveProcessStep[] {
  const settled = settleProcessSteps(steps)
  if (!Array.isArray(finalSteps)) return settled
  const persisted = finalSteps.filter(isProcessStepShape)
  const comparable = settled.map((step): ProcessStep | null => {
    if (step.kind === 'search') return step.action ? { kind: 'search', action: step.action } : null
    return { kind: step.kind, text: step.text }
  })
  const unchanged =
    persisted.length === comparable.length &&
    persisted.every((step, index) => JSON.stringify(step) === JSON.stringify(comparable[index]))
  if (unchanged) return settled
  return liveStepsFromPersisted(persisted).map((step) => ({
    ...step,
    id: step.id.replace('saved-', 'final-'),
  }))
}

function outputItemId(data: Record<string, unknown>): string {
  const item =
    typeof data.item === 'object' && data.item !== null
      ? (data.item as Record<string, unknown>)
      : null
  return str(item?.id) || str(data.item_id)
}

function addCommentaryStep(s: LiveMessage, ev: WireEvent): LiveMessage {
  const item =
    typeof ev.data.item === 'object' && ev.data.item !== null
      ? (ev.data.item as Record<string, unknown>)
      : null
  if (item?.type !== 'message' || item.phase !== 'commentary') return s
  const id = outputItemId(ev.data)
  if (!id || s.processSteps.some((step) => step.kind === 'commentary' && step.id === id)) return s
  return {
    ...s,
    processSteps: [...s.processSteps, { kind: 'commentary', id, text: '' }],
  }
}

function appendOutputText(s: LiveMessage, data: Record<string, unknown>): LiveMessage {
  const itemId = str(data.item_id)
  const index = itemId
    ? s.processSteps.findIndex((step) => step.kind === 'commentary' && step.id === itemId)
    : -1
  if (index < 0) return { ...s, text: s.text + str(data.delta) }
  const processSteps = s.processSteps.slice()
  const step = processSteps[index] as Extract<LiveProcessStep, { kind: 'commentary' }>
  processSteps[index] = { ...step, text: step.text + str(data.delta) }
  return { ...s, processSteps }
}

function reclassifyOutputItem(s: LiveMessage, data: Record<string, unknown>): LiveMessage {
  const itemId = str(data.itemId)
  const commentaryText = str(data.commentaryText)
  if (!itemId || data.phase !== 'commentary') return s

  const index = s.processSteps.findIndex((step) => step.kind === 'commentary' && step.id === itemId)
  const processSteps = s.processSteps.slice()
  const commentaryStep: LiveProcessStep = { kind: 'commentary', id: itemId, text: commentaryText }
  if (index >= 0) processSteps[index] = commentaryStep
  else processSteps.push(commentaryStep)

  return {
    ...s,
    text: typeof data.answerText === 'string' ? data.answerText : s.text,
    annotations: Array.isArray(data.annotations)
      ? (data.annotations as UrlCitation[])
      : s.annotations,
    processSteps,
    answerStarted: false,
    reasoningDurationMs: null,
  }
}

function reasoningStepId(data: Record<string, unknown>): string {
  const itemId = str(data.item_id)
  if (itemId) return itemId
  return typeof data.output_index === 'number' ? `output-${data.output_index}` : 'reasoning'
}

function appendReasoningDelta(
  s: LiveMessage,
  data: Record<string, unknown>,
  kind: 'summary' | 'raw',
): LiveMessage {
  if (!str(data.delta)) return markUpstreamStarted(s)
  if (kind === 'raw' && s.reasoningKind === 'summary') return markUpstreamStarted(s)

  const baseSteps =
    kind === 'summary' && s.reasoningKind === 'raw'
      ? s.processSteps.map((step) =>
          step.kind === 'reasoning' ? { ...step, text: '', partKey: null } : step,
        )
      : s.processSteps
  const id = reasoningStepId(data)
  let index = baseSteps.findIndex((step) => step.kind === 'reasoning' && step.id === id)
  const processSteps = baseSteps.slice()
  if (index < 0) {
    index = processSteps.length
    processSteps.push({ kind: 'reasoning', id, text: '', partKey: null })
  }
  const step = processSteps[index] as Extract<LiveProcessStep, { kind: 'reasoning' }>
  const next =
    kind === 'summary'
      ? appendReasoningSummaryDelta({ text: step.text, partKey: step.partKey }, data)
      : appendReasoningTextDelta({ text: step.text, partKey: step.partKey }, data)
  processSteps[index] = { ...step, text: next.text, partKey: next.partKey }
  return {
    ...markUpstreamStarted(s),
    processSteps,
    reasoningKind: kind,
  }
}

function markUpstreamStarted(s: LiveMessage): LiveMessage {
  return { ...s, upstreamStartedAt: s.upstreamStartedAt ?? Date.now() }
}

function finishReasoning(s: LiveMessage, exactDurationMs: number | null = null): LiveMessage {
  if (s.reasoningDurationMs !== null) return s
  if (exactDurationMs !== null) {
    return { ...s, reasoningDurationMs: Math.max(0, exactDurationMs) }
  }
  if (!s.upstreamStartedAt) return s
  return { ...s, reasoningDurationMs: Math.max(0, Date.now() - s.upstreamStartedAt) }
}

/** 拒绝或内容过滤会让后端删除生成附件，这里同步清掉所有可见的部分结果引用。 */
function clearDiscardedOutput(s: LiveMessage): LiveMessage {
  return {
    ...s,
    text: '',
    reasoningKind: null,
    processSteps: [],
    answerStarted: false,
    annotations: [],
    imageStatus: undefined,
    imageGenerations: [],
    imageAttachmentId: undefined,
    imagePreviewAttachmentId: undefined,
    imagePreviewIndex: null,
    imagePreviewUpdatedAt: null,
    imageRevisedPrompt: undefined,
    imageStartedAt: null,
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function imageGenerationEventId(
  data: Record<string, unknown>,
  generations: LiveImageGeneration[],
): string {
  const explicit = str(data.generationId) || str(data.callId) || str(data.item_id) || str(data.id)
  if (explicit) return explicit
  const index = num(data.index)
  if (index !== null) return `image-${index}`
  const active = generations
    .slice()
    .reverse()
    .find((generation) => generation.status === 'generating')
  return active?.id ?? `image-${generations.length}`
}

function syncLegacyImageFields(s: LiveMessage): LiveMessage {
  const generations = s.imageGenerations
  if (!generations.length) return { ...s, imageStatus: undefined }
  const visible =
    generations
      .slice()
      .reverse()
      .find((generation) => generation.status !== 'done') ?? generations[generations.length - 1]
  const allDone = generations.every(
    (generation) => generation.status === 'done' && Boolean(generation.attachmentId),
  )
  const firstStartedAt = generations.reduce<number | null>((earliest, generation) => {
    if (generation.startedAt === null) return earliest
    return earliest === null ? generation.startedAt : Math.min(earliest, generation.startedAt)
  }, null)

  return {
    ...s,
    imageStatus: allDone ? 'done' : 'generating',
    imageAttachmentId: visible?.attachmentId,
    imagePreviewAttachmentId: visible?.attachmentId || visible?.previewAttachmentId,
    imagePreviewIndex: visible?.previewIndex ?? null,
    imagePreviewUpdatedAt: visible?.previewUpdatedAt ?? null,
    imageRevisedPrompt: visible?.revisedPrompt,
    imageStartedAt: s.imageStartedAt ?? firstStartedAt,
  }
}

function upsertImageGeneration(
  s: LiveMessage,
  data: Record<string, unknown>,
  patch: Partial<LiveImageGeneration>,
): LiveMessage {
  const now = Date.now()
  const id = imageGenerationEventId(data, s.imageGenerations)
  const callId = str(data.callId) || str(data.item_id) || str(data.id) || patch.callId
  const existingIndex = s.imageGenerations.findIndex(
    (generation) =>
      generation.id === id || (callId && generation.callId && generation.callId === callId),
  )
  const existing = existingIndex >= 0 ? s.imageGenerations[existingIndex] : null
  const index = num(data.index) ?? existing?.index ?? s.imageGenerations.length
  const outputIndex = num(data.outputIndex) ?? existing?.outputIndex ?? null
  const nextGeneration: LiveImageGeneration = {
    id: existing?.id ?? id,
    ...(existing?.callId || callId ? { callId: existing?.callId ?? callId } : {}),
    index,
    outputIndex,
    status: existing?.status ?? 'generating',
    previewIndex: existing?.previewIndex ?? null,
    previewUpdatedAt: existing?.previewUpdatedAt ?? null,
    startedAt: existing?.startedAt ?? (s.imageGenerations.length ? now : (s.imageStartedAt ?? now)),
    completedAt: existing?.completedAt ?? null,
    ...patch,
  }
  const nextGenerations =
    existingIndex >= 0
      ? s.imageGenerations.map((generation, idx) =>
          idx === existingIndex ? nextGeneration : generation,
        )
      : [...s.imageGenerations, nextGeneration]

  nextGenerations.sort((a, b) => a.index - b.index)
  return syncLegacyImageFields({ ...s, imageGenerations: nextGenerations })
}

/** 将一个 SSE WireEvent 折叠进流式消息状态。 */
export function reduceEvent(s: LiveMessage, ev: WireEvent): LiveMessage {
  switch (ev.type) {
    case 'run.created':
      return {
        ...s,
        reasoningEnabled:
          typeof ev.data.reasoningEnabled === 'boolean'
            ? ev.data.reasoningEnabled
            : s.reasoningEnabled,
      }
    case 'response.created':
    case 'response.in_progress':
      return markUpstreamStarted(s)
    case 'answer.started':
      return { ...finishReasoning(s, num(ev.data.reasoningDurationMs)), answerStarted: true }
    case RUN_EVENT_TYPE.outputItemReclassified:
      return reclassifyOutputItem(s, ev.data)
    case 'response.output_text.delta':
      return appendOutputText(s, ev.data)
    case 'response.reasoning_summary_text.delta':
      return appendReasoningDelta(s, ev.data, 'summary')
    case 'response.reasoning_text.delta':
      return appendReasoningDelta(s, ev.data, 'raw')
    case 'response.output_text.annotation.added': {
      const itemId = str(ev.data.item_id)
      if (
        itemId &&
        s.processSteps.some((step) => step.kind === 'commentary' && step.id === itemId)
      ) {
        return s
      }
      const a = ev.data.annotation as UrlCitation | undefined
      if (a && a.type === 'url_citation') return { ...s, annotations: [...s.annotations, a] }
      return s
    }
    // web_search_call 的动作细节（搜索词/URL）只在 output_item 事件里出现；
    // xAI 旧实现的 item 首次出现即 completed，x_search 的 custom_tool_call 也在这里建行。
    case 'response.output_item.added': {
      const withCommentary = addCommentaryStep(s, ev)
      return reduceSearchItemEvent(withCommentary, ev)
    }
    case 'response.output_item.done':
      return reduceSearchItemEvent(s, ev)
    // x_search 没有专用 lifecycle 事件，参数由 custom_tool_call_input 单独下发。
    case 'response.custom_tool_call_input.done':
      return reduceXSearchInputEvent(s, ev)
    case 'response.web_search_call.in_progress':
      return upsertSearchStep(s, searchCallIdFromEvent(ev.data), { status: 'in_progress' })
    case 'response.web_search_call.searching':
      return upsertSearchStep(s, searchCallIdFromEvent(ev.data), { status: 'searching' })
    case 'response.web_search_call.completed':
      return upsertSearchStep(s, searchCallIdFromEvent(ev.data), { status: 'completed' })
    case 'image.generation.in_progress':
      return upsertImageGeneration(s, ev.data, { status: 'generating' })
    case 'image.generation.partial': {
      const attachmentId = str(ev.data.attachmentId)
      if (!attachmentId) {
        return upsertImageGeneration(s, ev.data, { status: 'generating' })
      }
      const partialIndex =
        typeof ev.data.partialIndex === 'number' ? ev.data.partialIndex : s.imagePreviewIndex
      return upsertImageGeneration(s, ev.data, {
        status: 'generating',
        previewAttachmentId: attachmentId,
        previewIndex: partialIndex,
        previewUpdatedAt: Date.now(),
      })
    }
    case 'image.generation.completed':
      return upsertImageGeneration(s, ev.data, {
        status: 'done',
        attachmentId: str(ev.data.attachmentId),
        previewAttachmentId: str(ev.data.attachmentId) || undefined,
        previewUpdatedAt: Date.now(),
        revisedPrompt: str(ev.data.revisedPrompt) || undefined,
        completedAt: Date.now(),
      })
    case 'run.done': {
      const completed = finishReasoning(s)
      const finalText = typeof ev.data.text === 'string' ? ev.data.text : completed.text
      return {
        ...completed,
        // 最终正文、过程轨、引用和终态一次提交；不经过空内容，避免视觉闪烁。
        text: finalText,
        // 极少数兼容上游没有可用 delta；终态正文仍应触发过程轨折叠。
        answerStarted: completed.answerStarted || finalText.length > 0,
        processSteps: finalProcessSteps(completed.processSteps, ev.data.processSteps),
        annotations: finalAnnotations(ev.data.annotations, completed.annotations),
        status: (str(ev.data.state) as LiveStatus) || 'completed',
      }
    }
    case 'run.error': {
      const failed: LiveMessage = {
        ...finishReasoning(s),
        status: 'failed',
        error: str(ev.data.message) || '生成失败',
        processSteps: settleProcessSteps(s.processSteps),
      }
      if (ev.data.discardPartialOutput !== true) return failed
      return clearDiscardedOutput(failed)
    }
    case 'run.canceled':
      return {
        ...finishReasoning(s),
        status: 'canceled',
        processSteps: settleProcessSteps(s.processSteps),
      }
    case 'run.interrupted':
      return {
        ...finishReasoning(s),
        status: 'interrupted',
        processSteps: settleProcessSteps(s.processSteps),
      }
    default:
      return s
  }
}

/** 批量折叠一组 SSE 事件；恢复回放时显著减少字符串复制和 store 更新次数。 */
export function reduceEvents(s: LiveMessage, events: WireEvent[]): LiveMessage {
  return compactAppendEvents(events).reduce((next, ev) => reduceEvent(next, ev), s)
}
