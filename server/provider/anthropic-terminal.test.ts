import { describe, expect, it } from 'vitest'
import { classifyAnthropicTerminal } from './anthropic-terminal'

describe('classifyAnthropicTerminal', () => {
  it.each(['end_turn', 'stop_sequence'] as const)('把 %s 归为完成', (stopReason) => {
    expect(classifyAnthropicTerminal(stopReason).state).toBe('completed')
  })

  it.each(['max_tokens', 'model_context_window_exceeded'] as const)(
    '把 %s 归为未完整完成并保留原因',
    (stopReason) => {
      expect(classifyAnthropicTerminal(stopReason)).toMatchObject({
        state: 'incomplete',
        incompleteReason: stopReason,
      })
    },
  )

  it.each(['refusal', 'tool_use', 'future_stop_reason'] as const)(
    '把非完成原因 %s 归为失败并保留原值',
    (stopReason) => {
      expect(classifyAnthropicTerminal(stopReason)).toMatchObject({
        state: 'failed',
        errorType: stopReason,
        discardPartialOutput: stopReason === 'refusal',
      })
    },
  )

  it('缺少 stop_reason 时不猜测为成功', () => {
    expect(classifyAnthropicTerminal(null)).toMatchObject({
      state: 'failed',
      errorType: 'invalid_response',
    })
  })
})
