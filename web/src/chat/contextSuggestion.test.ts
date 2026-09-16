import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_POLICY, type ContextMessage } from '@shared/util/contextPolicy'
import { estimateContextTextTokens } from './contextSuggestion'

describe('上下文优化建议的文本估算', () => {
  const messages: ContextMessage[] = [
    { role: 'user', content: [{ type: 'input_text', text: '中文问题' }] },
    { role: 'assistant', content: [{ type: 'output_text', text: 'a'.repeat(40) }] },
    { role: 'user', content: [{ type: 'input_text', text: '后续' }] },
    { role: 'assistant', content: [{ type: 'output_text', text: 'abcd' }] },
  ]

  it('估算中英文文字，但不把附件体积伪装成精确token', () => {
    expect(estimateContextTextTokens(messages, DEFAULT_CONTEXT_POLICY)).toBe(17)
    expect(
      estimateContextTextTokens(
        [{ role: 'user', content: [{ type: 'input_image', attachment_id: 'image' }] }],
        DEFAULT_CONTEXT_POLICY,
      ),
    ).toBe(0)
  })

  it('只计算下次请求保留的历史，调整保留轮数后建议随之消失', () => {
    expect(
      estimateContextTextTokens(messages, { ...DEFAULT_CONTEXT_POLICY, historyTurns: 1 }),
    ).toBe(3)
    expect(
      estimateContextTextTokens(messages, { ...DEFAULT_CONTEXT_POLICY, historyTurns: 0 }),
    ).toBe(0)
  })
})
