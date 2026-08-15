export type ChatTerminalState = 'completed' | 'incomplete' | 'failed'

export interface ChatTerminalOutcome {
  state: ChatTerminalState
  incompleteReason: string | null
  errorType: string | null
  discardPartialOutput: boolean
}

interface ClassifyChatTerminalInput {
  finishReason?: string | null
  refusalObserved?: boolean
  toolCallObserved?: boolean
  /** 部分兼容网关只用 [DONE] 表示正常完成。 */
  doneObserved?: boolean
}

/** 只归一 Chat Completions 的业务终态；错误文案与持久化由调用方负责。 */
export function classifyChatTerminal(input: ClassifyChatTerminalInput): ChatTerminalOutcome {
  if (input.refusalObserved) {
    return {
      state: 'failed',
      incompleteReason: null,
      errorType: 'refusal',
      discardPartialOutput: true,
    }
  }
  if (input.toolCallObserved) {
    return {
      state: 'failed',
      incompleteReason: null,
      errorType: 'tool_calls',
      discardPartialOutput: false,
    }
  }

  switch (input.finishReason) {
    case 'stop':
      return {
        state: 'completed',
        incompleteReason: null,
        errorType: null,
        discardPartialOutput: false,
      }
    case 'length':
      return {
        state: 'incomplete',
        incompleteReason: 'max_output_tokens',
        errorType: null,
        discardPartialOutput: false,
      }
    case 'content_filter':
      return {
        state: 'failed',
        incompleteReason: null,
        errorType: 'content_filter',
        discardPartialOutput: true,
      }
    case 'tool_calls':
    case 'function_call':
      return {
        state: 'failed',
        incompleteReason: null,
        errorType: 'tool_calls',
        discardPartialOutput: false,
      }
    case null:
    case undefined:
    case '':
      return input.doneObserved
        ? {
            state: 'completed',
            incompleteReason: null,
            errorType: null,
            discardPartialOutput: false,
          }
        : {
            state: 'failed',
            incompleteReason: null,
            errorType: 'invalid_response',
            discardPartialOutput: false,
          }
    default:
      return {
        state: 'failed',
        incompleteReason: null,
        errorType: 'unsupported_finish_reason',
        discardPartialOutput: false,
      }
  }
}
