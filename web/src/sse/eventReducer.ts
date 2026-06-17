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
  annotations: UrlCitation[]
  status: LiveStatus
  error?: string
  webSearching: boolean
  imageStatus?: 'generating' | 'done'
  imageAttachmentId?: string
}

export const initialLive = (): LiveMessage => ({
  text: '',
  reasoning: '',
  annotations: [],
  status: 'streaming',
  webSearching: false,
})

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 将一个 SSE WireEvent 折叠进流式消息状态。 */
export function reduceEvent(s: LiveMessage, ev: WireEvent): LiveMessage {
  switch (ev.type) {
    case 'response.output_text.delta':
      return { ...s, text: s.text + str(ev.data.delta) }
    case 'response.reasoning_summary_text.delta':
      return { ...s, reasoning: s.reasoning + str(ev.data.delta) }
    case 'response.output_text.annotation.added': {
      const a = ev.data.annotation as UrlCitation | undefined
      if (a && a.type === 'url_citation') return { ...s, annotations: [...s.annotations, a] }
      return s
    }
    case 'response.web_search_call.in_progress':
    case 'response.web_search_call.searching':
      return { ...s, webSearching: true }
    case 'response.web_search_call.completed':
      return { ...s, webSearching: false }
    case 'image.generation.in_progress':
      return { ...s, imageStatus: 'generating' }
    case 'image.generation.completed':
      return { ...s, imageStatus: 'done', imageAttachmentId: str(ev.data.attachmentId) }
    case 'run.done':
      return { ...s, status: (str(ev.data.state) as LiveStatus) || 'completed', webSearching: false }
    case 'run.error':
      return { ...s, status: 'failed', error: str(ev.data.message) || '生成失败', webSearching: false }
    case 'run.canceled':
      return { ...s, status: 'canceled', webSearching: false }
    case 'run.interrupted':
      return { ...s, status: 'interrupted', webSearching: false }
    default:
      return s
  }
}
