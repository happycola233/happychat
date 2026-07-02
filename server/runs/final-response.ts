import type { MessageUsage, UrlCitation } from '@shared/types/domain'
import { parseResponse } from '../provider/normalize'
import type { UpstreamResponse } from '../provider/upstream-types'

export interface StreamedResponseSnapshot {
  text: string
  reasoningSummary: string | null
  annotations: UrlCitation[]
  usage: MessageUsage
  upstreamResponseId: string | null
}

function hasOutputText(response: UpstreamResponse): boolean {
  return (response.output ?? []).some(
    (item) =>
      item.type === 'message' &&
      (item.content ?? []).some((contentPart) => contentPart.type === 'output_text'),
  )
}

function hasReasoningSummary(response: UpstreamResponse): boolean {
  return (response.output ?? []).some(
    (item) => item.type === 'reasoning' && (item.summary?.length ?? 0) > 0,
  )
}

/**
 * 用终态 Response 校准流式累计值。
 *
 * 正常情况下 delta 拼接与终态内容一致；若上游在流中短暂输出内部占位符、
 * 随后又在终态对象中修正，则以终态对象为准。兼容上游若省略 output/usage，
 * 仍保留已经收到的流式内容，避免把有效结果错误清空。
 */
export function reconcileFinalResponse(
  current: StreamedResponseSnapshot,
  response: UpstreamResponse | undefined,
): StreamedResponseSnapshot {
  if (!response) return current

  const parsed = parseResponse(response)
  const outputTextIsFinal = hasOutputText(response)
  const reasoningSummaryIsFinal = hasReasoningSummary(response)

  return {
    text: outputTextIsFinal ? parsed.text : current.text,
    reasoningSummary: reasoningSummaryIsFinal ? parsed.reasoningSummary : current.reasoningSummary,
    annotations: outputTextIsFinal ? parsed.annotations : current.annotations,
    usage: response.usage ? parsed.usage : current.usage,
    upstreamResponseId: parsed.responseId ?? current.upstreamResponseId,
  }
}
