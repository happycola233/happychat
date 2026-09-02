import type {
  AssistantPhase,
  ContentPart,
  MessageUsage,
  ProcessStep,
  SearchAction,
  UrlCitation,
} from '@shared/types/domain'
import { joinReasoningSummaryParts } from '@shared/util/reasoningSummary'
import { mergeSearchAction, searchActionFromItem } from '@shared/util/searchActivity'
import type { UpstreamResponse, UpstreamUsage } from './upstream-types'

export interface ParsedResponse {
  responseId: string | null
  status: string
  text: string
  content: ContentPart[]
  annotations: UrlCitation[]
  processSteps: ProcessStep[]
  usage: MessageUsage
  incompleteReason: string | null
  error: { message: string; code?: string } | null
}

export interface ParseResponseOptions {
  messagePhaseByItemId?: ReadonlyMap<string, AssistantPhase>
  searchActionByItemId?: ReadonlyMap<string, SearchAction>
}

export function mapUsage(u: UpstreamUsage | undefined): MessageUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    cacheWriteTokens: u?.input_tokens_details?.cache_write_tokens ?? 0,
    cachedTokens: u?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    reasoningTokens: u?.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: u?.total_tokens ?? 0,
  }
}

/** 解析非流式 Response 对象的 output[]：拼接正文、收集引用与思考摘要。 */
export function parseResponse(
  r: UpstreamResponse,
  options: ParseResponseOptions = {},
): ParsedResponse {
  let text = ''
  const content: ContentPart[] = []
  const processSteps: ProcessStep[] = []
  const annotations: UrlCitation[] = []
  const hasReasoningSummary = (r.output ?? []).some(
    (item) => item.type === 'reasoning' && (item.summary ?? []).some((part) => part.text),
  )

  for (const item of r.output ?? []) {
    if (item.type === 'message') {
      let itemText = ''
      const itemAnnotations: UrlCitation[] = []
      for (const part of item.content ?? []) {
        if (part.type === 'output_text') {
          itemText += part.text ?? ''
          for (const a of part.annotations ?? []) {
            if (a.type === 'url_citation' && a.url) {
              itemAnnotations.push({
                type: 'url_citation',
                url: a.url,
                title: a.title ?? '',
                start_index: a.start_index ?? 0,
                end_index: a.end_index ?? 0,
              })
            }
          }
        }
      }
      const capturedPhase = item.id ? options.messagePhaseByItemId?.get(item.id) : undefined
      const phase =
        item.phase === 'commentary' || item.phase === 'final_answer' ? item.phase : capturedPhase
      if (phase === 'commentary') {
        if (itemText) processSteps.push({ kind: 'commentary', text: itemText })
      } else {
        text += itemText
        annotations.push(...itemAnnotations)
        if (itemText || itemAnnotations.length > 0) {
          content.push({
            type: 'output_text',
            text: itemText,
            ...(itemAnnotations.length > 0 ? { annotations: itemAnnotations } : {}),
            ...(phase === 'final_answer' ? { phase } : {}),
          })
        }
      }
    } else if (item.type === 'reasoning') {
      const summary = joinReasoningSummaryParts((item.summary ?? []).map((part) => part.text ?? ''))
      const raw = joinReasoningSummaryParts(
        (item.content ?? [])
          .filter((part) => part.type === 'reasoning_text')
          .map((part) => part.text ?? ''),
      )
      const reasoningText = hasReasoningSummary ? summary : raw
      if (reasoningText) processSteps.push({ kind: 'reasoning', text: reasoningText })
    } else {
      const capturedAction = item.id ? options.searchActionByItemId?.get(item.id) : undefined
      const action = mergeSearchAction(capturedAction ?? null, searchActionFromItem(item))
      if (action) processSteps.push({ kind: 'search', action })
    }
  }

  return {
    responseId: r.id ?? null,
    status: r.status ?? 'completed',
    text,
    content,
    annotations,
    processSteps,
    usage: mapUsage(r.usage),
    incompleteReason: r.incomplete_details?.reason ?? null,
    error: r.error ? { message: r.error.message ?? '生成失败', code: r.error.code } : null,
  }
}

export function buildAssistantContent(text: string): ContentPart[] {
  return [{ type: 'output_text', text }]
}
