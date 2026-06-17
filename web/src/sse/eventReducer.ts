import type { UrlCitation } from '@shared/types/domain'
import type { WireEvent } from '@shared/types/events'

export type LiveStatus =
  | 'streaming'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'canceled'
  | 'interrupted'

export interface LiveMessage {
  text: string
  reasoning: string
  upstreamStartedAt: number | null
  reasoningDurationMs: number | null
  reasoningEnabled: boolean
  annotations: UrlCitation[]
  status: LiveStatus
  error?: string
  webSearching: boolean
  webSearchCallIds: string[]
  imageStatus?: 'generating' | 'done'
  imageAttachmentId?: string
  imageStartedAt: number | null
}

export const initialLive = (
  upstreamStartedAt: number | null = null,
  reasoningEnabled = false,
): LiveMessage => ({
  text: '',
  reasoning: '',
  upstreamStartedAt,
  reasoningDurationMs: null,
  reasoningEnabled,
  annotations: [],
  status: 'streaming',
  webSearching: false,
  webSearchCallIds: [],
  imageStartedAt: null,
})

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

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
    case 'response.reasoning_summary_text.delta':
      return {
        ...markUpstreamStarted(s),
        reasoning: s.reasoning + str(ev.data.delta),
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
      return { ...s, imageStatus: 'generating', imageStartedAt: s.imageStartedAt ?? Date.now() }
    case 'image.generation.completed':
      return { ...s, imageStatus: 'done', imageAttachmentId: str(ev.data.attachmentId) }
    case 'run.done':
      return {
        ...finishReasoning(s),
        status: (str(ev.data.state) as LiveStatus) || 'completed',
        webSearching: false,
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
