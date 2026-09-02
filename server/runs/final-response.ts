import type {
  AssistantPhase,
  ContentPart,
  MessageUsage,
  ProcessStep,
  SearchAction,
  UrlCitation,
} from '@shared/types/domain'
import { parseResponse } from '../provider/normalize'
import type { UpstreamResponse } from '../provider/upstream-types'

export interface StreamedResponseSnapshot {
  text: string
  content: ContentPart[]
  processSteps: ProcessStep[]
  annotations: UrlCitation[]
  usage: MessageUsage
  upstreamResponseId: string | null
}

export interface FinalResponseReconcileOptions {
  /**
   * 流中已经出现的 output item。官方终态应完整包含它们；部分兼容网关会把终态
   * 错误压扁成单条 message，此时不能让残缺拓扑覆盖已验证的流式过程轨。
   */
  observedOutputItemIds?: readonly string[]
  /** added/done 已明确给出的字段可补齐终态 item 的兼容性缺失，但绝不凭空创造。 */
  messagePhaseByItemId?: ReadonlyMap<string, AssistantPhase>
  searchActionByItemId?: ReadonlyMap<string, SearchAction>
}

function hasCompleteOutputTopology(
  response: UpstreamResponse,
  observedOutputItemIds: readonly string[],
): boolean {
  if (!observedOutputItemIds.length) return true
  const terminalIds = new Set(
    (response.output ?? []).flatMap((item) => (typeof item.id === 'string' ? [item.id] : [])),
  )
  return observedOutputItemIds.every((id) => terminalIds.has(id))
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
  options: FinalResponseReconcileOptions = {},
): StreamedResponseSnapshot {
  if (!response) return current

  const parsed = parseResponse(response, options)
  const outputIsFinal =
    Array.isArray(response.output) &&
    response.output.length > 0 &&
    hasCompleteOutputTopology(response, options.observedOutputItemIds ?? [])

  return {
    text: outputIsFinal ? parsed.text : current.text,
    content: outputIsFinal ? parsed.content : current.content,
    processSteps: outputIsFinal ? parsed.processSteps : current.processSteps,
    annotations: outputIsFinal ? parsed.annotations : current.annotations,
    usage: response.usage ? parsed.usage : current.usage,
    upstreamResponseId: parsed.responseId ?? current.upstreamResponseId,
  }
}
