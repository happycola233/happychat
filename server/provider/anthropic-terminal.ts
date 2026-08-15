export type AnthropicTerminalState = 'completed' | 'incomplete' | 'failed'

export interface AnthropicTerminalOutcome {
  state: AnthropicTerminalState
  incompleteReason: string | null
  errorType: string | null
  discardPartialOutput: boolean
}

/** 只归一 Anthropic Messages 的 stop_reason；续跑 pause_turn 仍由流式引擎负责。 */
export function classifyAnthropicTerminal(
  stopReason: string | null | undefined,
): AnthropicTerminalOutcome {
  if (stopReason === 'end_turn' || stopReason === 'stop_sequence') {
    return {
      state: 'completed',
      incompleteReason: null,
      errorType: null,
      discardPartialOutput: false,
    }
  }
  if (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded') {
    return {
      state: 'incomplete',
      incompleteReason: stopReason,
      errorType: null,
      discardPartialOutput: false,
    }
  }
  if (!stopReason) {
    return {
      state: 'failed',
      incompleteReason: null,
      errorType: 'invalid_response',
      discardPartialOutput: false,
    }
  }
  return {
    state: 'failed',
    incompleteReason: null,
    errorType: stopReason,
    discardPartialOutput: stopReason === 'refusal',
  }
}
