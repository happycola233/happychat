import { describe, expect, it } from 'vitest'
import { normalizeReasoningMarkdown } from './reasoningMarkdown'

describe('normalizeReasoningMarkdown', () => {
  it('inserts a paragraph break before a stuck bold heading', () => {
    expect(normalizeReasoningMarkdown('上一段。**Next heading**\n内容')).toBe(
      '上一段。\n\n**Next heading**\n内容',
    )
  })

  it('does not duplicate existing paragraph breaks', () => {
    const text = '上一段。\n\n**Next heading**\n内容'
    expect(normalizeReasoningMarkdown(text)).toBe(text)
  })

  it('does not split ordinary inline bold text', () => {
    const text = '这是 **important** 内容'
    expect(normalizeReasoningMarkdown(text)).toBe(text)
  })

  it('does not rewrite bold markers inside fenced code blocks', () => {
    const text = ['```md', '上一段。**Next heading**', '```', '完成。**Real heading**'].join('\n')
    expect(normalizeReasoningMarkdown(text)).toBe(
      ['```md', '上一段。**Next heading**', '```', '完成。\n\n**Real heading**'].join('\n'),
    )
  })
})
