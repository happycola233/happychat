import { describe, expect, it } from 'vitest'
import { classifyChatTerminal } from './chat-terminal'

describe('classifyChatTerminal', () => {
  it.each([
    [{ finishReason: 'stop' }, 'completed'],
    [{ doneObserved: true }, 'completed'],
    [{ finishReason: 'length' }, 'incomplete'],
  ] as const)('归一正常与截断终态 %#', (input, state) => {
    expect(classifyChatTerminal(input).state).toBe(state)
  })

  it.each([
    [{ refusalObserved: true }, 'refusal', true],
    [{ finishReason: 'content_filter' }, 'content_filter', true],
    [{ toolCallObserved: true }, 'tool_calls', false],
    [{ finishReason: 'function_call' }, 'tool_calls', false],
  ] as const)('归一拒绝、过滤与工具调用 %#', (input, errorType, discardPartialOutput) => {
    expect(classifyChatTerminal(input)).toMatchObject({
      state: 'failed',
      errorType,
      discardPartialOutput,
    })
  })

  it('非流式响应缺少 finish_reason 时不猜测为成功', () => {
    expect(classifyChatTerminal({})).toMatchObject({
      state: 'failed',
      errorType: 'invalid_response',
    })
  })
})
