import type { ContentPart, MessageUsage, UrlCitation } from '@shared/types/domain'
import { joinReasoningSummaryParts } from '@shared/util/reasoningSummary'
import type { UpstreamResponse, UpstreamUsage } from './upstream-types'

export interface ParsedResponse {
  responseId: string | null
  status: string
  text: string
  annotations: UrlCitation[]
  reasoningSummary: string | null
  usage: MessageUsage
  incompleteReason: string | null
  error: { message: string; code?: string } | null
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
export function parseResponse(r: UpstreamResponse): ParsedResponse {
  let text = ''
  const reasoningParts: string[] = []
  const annotations: UrlCitation[] = []

  for (const item of r.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text') {
          text += part.text ?? ''
          for (const a of part.annotations ?? []) {
            if (a.type === 'url_citation' && a.url) {
              annotations.push({
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
    } else if (item.type === 'reasoning') {
      for (const summaryPart of item.summary ?? []) {
        reasoningParts.push(summaryPart.text ?? '')
      }
    }
  }

  const reasoningSummary = joinReasoningSummaryParts(reasoningParts)

  return {
    responseId: r.id ?? null,
    status: r.status ?? 'completed',
    text,
    annotations,
    reasoningSummary: reasoningSummary || null,
    usage: mapUsage(r.usage),
    incompleteReason: r.incomplete_details?.reason ?? null,
    error: r.error ? { message: r.error.message ?? '生成失败', code: r.error.code } : null,
  }
}

export function buildAssistantContent(text: string): ContentPart[] {
  return [{ type: 'output_text', text }]
}
