import type { UrlCitation, WebSearchAction } from '@shared/types/domain'
import type { WireEvent } from '@shared/types/events'
import {
  appendReasoningSummaryDelta,
  responseDeltaIdentityKey,
} from '@shared/util/reasoningSummary'
import {
  isWebSearchCallItem,
  webSearchActionFromItem,
  webSearchCallIdFromEvent,
} from '@shared/util/webSearchActivity'

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

export type LiveWebSearchCallStatus = 'in_progress' | 'searching' | 'completed'

/**
 * 一次 web_search 工具调用的流式状态。搜索不是贯穿思考的持续状态，而是 0~N 个
 * 离散调用；查询词等动作细节要等调用完成（output_item.done）才出现。
 */
export interface LiveWebSearchCall {
  id: string
  status: LiveWebSearchCallStatus
  /** 调用完成后解析出的动作；进行中恒为 null。 */
  action: WebSearchAction | null
}

export const hasActiveWebSearch = (calls: readonly LiveWebSearchCall[]): boolean =>
  calls.some((call) => call.status !== 'completed')

/** 持久化消息（含分享快照）没有流式调用，把动作序列适配成已完成调用供同一 UI 渲染。 */
export function persistedWebSearchCalls(
  actions: WebSearchAction[] | null | undefined,
): LiveWebSearchCall[] {
  return (actions ?? []).map((action, index) => ({
    id: `saved-web-search-${index}`,
    status: 'completed' as const,
    action,
  }))
}

export interface LiveMessage {
  text: string
  reasoning: string
  /** 当前 OpenAI reasoning summary part 的身份，用于在结构化 part 之间保留段落边界。 */
  reasoningPartKey: string | null
  upstreamStartedAt: number | null
  reasoningDurationMs: number | null
  reasoningEnabled: boolean
  annotations: UrlCitation[]
  status: LiveStatus
  error?: string
  webSearchCalls: LiveWebSearchCall[]
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
  reasoning: '',
  reasoningPartKey: null,
  upstreamStartedAt,
  reasoningDurationMs: null,
  reasoningEnabled,
  annotations: [],
  status: 'streaming',
  webSearchCalls: [],
  imageGenerations: [],
  imagePreviewIndex: null,
  imagePreviewUpdatedAt: null,
  imageStartedAt: null,
})

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const APPEND_DELTA_TYPES = new Set([
  'response.output_text.delta',
  'response.reasoning_summary_text.delta',
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

interface WebSearchCallPatch {
  status?: LiveWebSearchCallStatus
  action?: WebSearchAction | null
}

function upsertWebSearchCall(s: LiveMessage, id: string, patch: WebSearchCallPatch): LiveMessage {
  // 无标识的事件回落到最近一个未完成调用（同图片生成的口径），避免重复建行。
  const index = id
    ? s.webSearchCalls.findIndex((call) => call.id === id)
    : s.webSearchCalls.findLastIndex((call) => call.status !== 'completed')
  if (index < 0) {
    const call: LiveWebSearchCall = {
      id: id || `web-search-${s.webSearchCalls.length}`,
      status: patch.status ?? 'in_progress',
      action: patch.action ?? null,
    }
    return { ...s, webSearchCalls: [...s.webSearchCalls, call] }
  }
  const existing = s.webSearchCalls[index]!
  const next: LiveWebSearchCall = {
    ...existing,
    // completed 不允许回退（防御事件乱序与续传重放）。
    status:
      existing.status === 'completed' ? 'completed' : (patch.status ?? existing.status),
    action: patch.action ?? existing.action,
  }
  if (next.status === existing.status && next.action === existing.action) return s
  const webSearchCalls = s.webSearchCalls.slice()
  webSearchCalls[index] = next
  return { ...s, webSearchCalls }
}

function reduceWebSearchItemEvent(s: LiveMessage, ev: WireEvent): LiveMessage {
  const item = ev.data.item
  if (!isWebSearchCallItem(item)) return s
  const completed = ev.type === 'response.output_item.done' || item.status === 'completed'
  return upsertWebSearchCall(s, webSearchCallIdFromEvent(ev.data), {
    ...(completed ? { status: 'completed' as const } : {}),
    action: webSearchActionFromItem(item),
  })
}

/**
 * 终态收口：结束所有仍在进行的调用，并丢弃始终没解析出动作的占位调用，
 * 与刷新后读到的持久化 webSearchActions 保持同一份内容。
 */
function settleWebSearchCalls(calls: LiveWebSearchCall[]): LiveWebSearchCall[] {
  const settled = calls
    .filter((call) => call.action !== null)
    .map((call) => (call.status === 'completed' ? call : { ...call, status: 'completed' as const }))
  return settled.length === calls.length && settled.every((call, i) => call === calls[i])
    ? calls
    : settled
}

function isWebSearchActionShape(value: unknown): value is WebSearchAction {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return type === 'search' || type === 'open_page' || type === 'find_in_page'
}

/** run.done 携带的终态动作序列是权威值；与流式解析一致时保留原行身份，避免 UI 重播入场动画。 */
function finalWebSearchCalls(
  calls: LiveWebSearchCall[],
  finalActions: unknown,
): LiveWebSearchCall[] {
  const settled = settleWebSearchCalls(calls)
  if (!Array.isArray(finalActions)) return settled
  const actions = finalActions.filter(isWebSearchActionShape)
  const unchanged =
    actions.length === settled.length &&
    actions.every(
      (action, index) => JSON.stringify(action) === JSON.stringify(settled[index]?.action),
    )
  if (unchanged) return settled
  return actions.map((action, index) => ({
    id: `final-web-search-${index}`,
    status: 'completed' as const,
    action,
  }))
}

function markUpstreamStarted(s: LiveMessage): LiveMessage {
  return { ...s, upstreamStartedAt: s.upstreamStartedAt ?? Date.now() }
}

function finishReasoning(s: LiveMessage): LiveMessage {
  if (!s.upstreamStartedAt || s.reasoningDurationMs !== null) return s
  return { ...s, reasoningDurationMs: Math.max(0, Date.now() - s.upstreamStartedAt) }
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

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
    startedAt:
      existing?.startedAt ?? (s.imageGenerations.length ? now : (s.imageStartedAt ?? now)),
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
    case 'response.output_text.delta':
      return { ...finishReasoning(s), text: s.text + str(ev.data.delta) }
    case 'response.reasoning_summary_text.delta': {
      const nextReasoning = appendReasoningSummaryDelta(
        { text: s.reasoning, partKey: s.reasoningPartKey },
        ev.data,
      )
      return {
        ...markUpstreamStarted(s),
        reasoning: nextReasoning.text,
        reasoningPartKey: nextReasoning.partKey,
      }
    }
    case 'response.output_text.annotation.added': {
      const a = ev.data.annotation as UrlCitation | undefined
      if (a && a.type === 'url_citation') return { ...s, annotations: [...s.annotations, a] }
      return s
    }
    // web_search_call 的动作细节（搜索词/URL）只在 output_item 事件里出现；
    // xAI 旧实现的 item 首次出现即 completed，也在这里一并收口。
    case 'response.output_item.added':
    case 'response.output_item.done':
      return reduceWebSearchItemEvent(s, ev)
    case 'response.web_search_call.in_progress':
      return upsertWebSearchCall(s, webSearchCallIdFromEvent(ev.data), { status: 'in_progress' })
    case 'response.web_search_call.searching':
      return upsertWebSearchCall(s, webSearchCallIdFromEvent(ev.data), { status: 'searching' })
    case 'response.web_search_call.completed':
      return upsertWebSearchCall(s, webSearchCallIdFromEvent(ev.data), { status: 'completed' })
    case 'image.generation.in_progress':
      return upsertImageGeneration(s, ev.data, { status: 'generating' })
    case 'image.generation.partial': {
      const attachmentId = str(ev.data.attachmentId)
      if (!attachmentId) {
        return upsertImageGeneration(s, ev.data, { status: 'generating' })
      }
      const partialIndex =
        typeof ev.data.partialIndex === 'number'
          ? ev.data.partialIndex
          : s.imagePreviewIndex
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
      const hasFinalReasoning =
        Object.prototype.hasOwnProperty.call(ev.data, 'reasoningSummary') &&
        (typeof ev.data.reasoningSummary === 'string' || ev.data.reasoningSummary === null)
      return {
        ...completed,
        // 最终正文、思考、引用和终态一次提交；不经过空内容，避免视觉闪烁。
        text: finalText,
        reasoning: hasFinalReasoning
          ? (ev.data.reasoningSummary as string | null) ?? ''
          : completed.reasoning,
        reasoningPartKey: hasFinalReasoning ? null : completed.reasoningPartKey,
        annotations: finalAnnotations(ev.data.annotations, completed.annotations),
        status: (str(ev.data.state) as LiveStatus) || 'completed',
        webSearchCalls: finalWebSearchCalls(completed.webSearchCalls, ev.data.webSearchActions),
      }
    }
    case 'run.error':
      return {
        ...finishReasoning(s),
        status: 'failed',
        error: str(ev.data.message) || '生成失败',
        webSearchCalls: settleWebSearchCalls(s.webSearchCalls),
      }
    case 'run.canceled':
      return {
        ...finishReasoning(s),
        status: 'canceled',
        webSearchCalls: settleWebSearchCalls(s.webSearchCalls),
      }
    case 'run.interrupted':
      return {
        ...finishReasoning(s),
        status: 'interrupted',
        webSearchCalls: settleWebSearchCalls(s.webSearchCalls),
      }
    default:
      return s
  }
}

/** 批量折叠一组 SSE 事件；恢复回放时显著减少字符串复制和 store 更新次数。 */
export function reduceEvents(s: LiveMessage, events: WireEvent[]): LiveMessage {
  return compactAppendEvents(events).reduce((next, ev) => reduceEvent(next, ev), s)
}
