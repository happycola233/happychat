import type { UpstreamResponse } from './upstream-types'

export type ResponsesTerminalState = 'completed' | 'incomplete' | 'failed'

export interface ResponsesTerminalOutcome {
  state: ResponsesTerminalState
  incompleteReason: string | null
  errorType: string | null
  errorCode: string | null
  discardPartialOutput: boolean
}

interface ClassifyResponsesTerminalOptions {
  /** 流式事件名比部分兼容网关省略的 response.status 更可靠。 */
  eventState?: ResponsesTerminalState
  /** 流中可能先出现 refusal.delta/done，而终态对象未完整回填 output。 */
  refusalObserved?: boolean
}

function responseContainsRefusal(response: UpstreamResponse | undefined): boolean {
  return (response?.output ?? []).some(
    (item) =>
      item.type === 'message' &&
      (item.content ?? []).some((contentPart) => contentPart.type === 'refusal'),
  )
}

/**
 * 把 Responses 的生命周期状态、incomplete 原因与结构化 refusal 收敛为本站终态。
 * 这里只做协议判定，不拼文案、不写库，供流式聊天与非流式标题调用共同使用。
 */
export function classifyResponsesTerminal(
  response: UpstreamResponse | undefined,
  options: ClassifyResponsesTerminalOptions = {},
): ResponsesTerminalOutcome {
  if (options.refusalObserved || responseContainsRefusal(response)) {
    return {
      state: 'failed',
      incompleteReason: null,
      errorType: 'refusal',
      errorCode: null,
      discardPartialOutput: true,
    }
  }

  const responseStatus = response?.status
  const status =
    options.eventState ??
    (responseStatus === 'completed' ||
    responseStatus === 'incomplete' ||
    responseStatus === 'failed'
      ? responseStatus
      : null)

  if (status === 'incomplete') {
    const incompleteReason = response?.incomplete_details?.reason ?? 'max_output_tokens'
    if (incompleteReason === 'content_filter') {
      return {
        state: 'failed',
        incompleteReason: null,
        errorType: 'content_filter',
        errorCode: null,
        discardPartialOutput: true,
      }
    }
    return {
      state: 'incomplete',
      incompleteReason,
      errorType: null,
      errorCode: null,
      discardPartialOutput: false,
    }
  }

  if (status === 'completed') {
    return {
      state: 'completed',
      incompleteReason: null,
      errorType: null,
      errorCode: null,
      discardPartialOutput: false,
    }
  }

  if (!status && !responseStatus) {
    return {
      state: 'failed',
      incompleteReason: null,
      errorType: 'invalid_response',
      errorCode: null,
      discardPartialOutput: false,
    }
  }

  const errorCode = response?.error?.code ?? null
  return {
    state: 'failed',
    incompleteReason: null,
    errorType: errorCode ?? (responseStatus ? `response_${responseStatus}` : 'response_failed'),
    errorCode,
    discardPartialOutput: false,
  }
}
