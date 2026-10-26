import { describe, expect, it } from 'vitest'
import { incompleteRunMessage } from './incompleteRun'

describe('incompleteRunMessage', () => {
  it.each(['max_output_tokens', 'max_tokens'])(
    'explains the output budget for %s without calling it an API failure',
    (reason) => expect(incompleteRunMessage(reason)).toBe('已达到输出长度上限，回复未完成。'),
  )
  it('distinguishes the context window from the output budget', () => {
    expect(incompleteRunMessage('model_context_window_exceeded')).toBe(
      '已达到模型的上下文长度上限，回复未完成。',
    )
  })
  it('does not invent a length limit when no reason was provided', () => {
    expect(incompleteRunMessage(null)).toBe('生成提前结束，回复未完成。')
  })
})
