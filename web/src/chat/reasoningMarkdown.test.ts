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

  it('keeps the historical OpenAI comment separator while restoring the next heading', () => {
    const text = '**First**\n\n<!-- -->**Second**\n\n<!-- -->'
    expect(normalizeReasoningMarkdown(text)).toBe(
      '**First**\n\n<!-- -->\n\n**Second**\n\n<!-- -->',
    )
  })

  it('separates every heading in an adjacent bold summary chain', () => {
    const text =
      '**Analyzing primary requirement****Checking input constraints****Comparing candidate approaches**'

    expect(normalizeReasoningMarkdown(text)).toBe(
      [
        '**Analyzing primary requirement**',
        '**Checking input constraints**',
        '**Comparing candidate approaches**',
      ].join('\n\n'),
    )
  })

  it('leaves ordinary inline emphasis and inline code untouched', () => {
    const text = 'Keep **important text** inline.\n`**Alpha heading****Beta heading**`'
    expect(normalizeReasoningMarkdown(text)).toBe(text)
  })

  it('does not rewrite bold markers inside fenced code blocks', () => {
    const text = [
      '```md',
      '上一段。**Next heading**',
      '**Alpha heading****Beta heading**',
      '```',
      '完成。**Real heading**',
    ].join('\n')
    expect(normalizeReasoningMarkdown(text)).toBe(
      [
        '```md',
        '上一段。**Next heading**',
        '**Alpha heading****Beta heading**',
        '```',
        '完成。\n\n**Real heading**',
      ].join('\n'),
    )
  })
})
