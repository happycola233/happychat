import { describe, expect, it } from 'vitest'
import { normalizeMarkdownMath } from './markdownMath'

describe('normalizeMarkdownMath', () => {
  it('normalizes display math wrapped in LaTeX square delimiters', () => {
    expect(normalizeMarkdownMath('公式：\\[ x=\\frac{1}{2} \\]')).toBe(
      '公式：\n\n$$\nx=\\frac{1}{2}\n$$\n\n',
    )
  })

  it('normalizes inline math wrapped in LaTeX paren delimiters', () => {
    expect(normalizeMarkdownMath('这是 \\( a+b \\) 公式')).toBe('这是 $$a+b$$ 公式')
  })

  it('does not alter fenced code blocks', () => {
    const text = '```tex\n\\[ x=1 \\]\n```'

    expect(normalizeMarkdownMath(text)).toBe(text)
  })

  it('does not alter inline code spans', () => {
    const text = '输入 `\\(x\\)` 不应渲染'

    expect(normalizeMarkdownMath(text)).toBe(text)
  })
})
