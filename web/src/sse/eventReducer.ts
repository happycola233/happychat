import type { UrlCitation } from '@shared/types/domain'
import type { WireEvent } from '@shared/types/events'
import {
  appendReasoningSummaryDelta,
  responseDeltaIdentityKey,
} from '@shared/util/reasoningSummary'

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
  webSearching: boolean
  webSearchCallIds: string[]
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
  webSearching: false,
  webSearchCallIds: [],
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

function addWebSearchCall(s: LiveMessage, id: string): LiveMessage {
  if (!id) return { ...s, webSearching: true }
  if (s.webSearchCallIds.includes(id)) return { ...s, webSearching: true }
  return { ...s, webSearching: true, webSearchCallIds: [...s.webSearchCallIds, id] }
}

function finishWebSearchCall(s: LiveMessage, id: string): LiveMessage {
  if (!id) return { ...s, webSearching: false, webSearchCallIds: [] }
  const webSearchCallIds = s.webSearchCallIds.filter((item) => item !== id)
  return { ...s, webSearchCallIds, webSearching: webSearchCallIds.length > 0 }
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
    case 'response.web_search_call.in_progress':
    case 'response.web_search_call.searching':
      return addWebSearchCall(s, str(ev.data.item_id))
    case 'response.web_search_call.completed':
      return finishWebSearchCall(s, str(ev.data.item_id))
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
        webSearching: false,
      }
    }
    case 'run.error':
      return {
        ...finishReasoning(s),
        status: 'failed',
        error: str(ev.data.message) || '生成失败',
        webSearching: false,
      }
    case 'run.canceled':
      return { ...finishReasoning(s), status: 'canceled', webSearching: false }
    case 'run.interrupted':
      return { ...finishReasoning(s), status: 'interrupted', webSearching: false }
    default:
      return s
  }
}

/** 批量折叠一组 SSE 事件；恢复回放时显著减少字符串复制和 store 更新次数。 */
export function reduceEvents(s: LiveMessage, events: WireEvent[]): LiveMessage {
  return compactAppendEvents(events).reduce((next, ev) => reduceEvent(next, ev), s)
}
