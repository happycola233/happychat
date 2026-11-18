import { describe, expect, it } from 'vitest'
import { normalizeMarkdownMath } from './markdownMath'

describe('normalizeMarkdownMath', () => {
  it('normalizes display math wrapped in LaTeX square delimiters', () => {
    expect(normalizeMarkdownMath('公式：\\[ x=\\frac{1}{2} \\]')).toBe(
      '公式：\n\n$$\nx=\\frac{1}{2}\n$$\n\n',
    )
  })

  it('keeps blockquote prefixes on standalone display math delimiter lines', () => {
    const text = [
      '> 在幂级数  ',
      '> \\[',
      '> \\sum_{n=0}^{\\infty}a_n(x-x_0)^n',
      '> \\]',
      '> 中',
    ].join('\n')

    expect(normalizeMarkdownMath(text)).toBe(
      [
        '> 在幂级数  ',
        '> $$',
        '> \\sum_{n=0}^{\\infty}a_n(x-x_0)^n',
        '> $$',
        '> 中',
      ].join('\n'),
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

  it('normalizes single dollar inline math', () => {
    expect(normalizeMarkdownMath('设 $a+b=c$，则 $x_1$ 成立')).toBe('设 $$a+b=c$$，则 $$x_1$$ 成立')
  })

  it.each([
    '价格从 $5 涨到 $10',
    'from $20,000 to $30,000',
    'range $5-$10 per unit',
    'US$5 和 HK$10',
    'a $ x $ b',
    'escaped \\$x\\$ stays text',
    'cost $5.',
  ])('keeps currency-like dollars as text: %s', (text) => {
    expect(normalizeMarkdownMath(text)).toBe(text)
  })

  it('does not let single dollar math span blank lines or other dollar runs', () => {
    expect(normalizeMarkdownMath('$a\n\nb$')).toBe('$a\n\nb$')
    expect(normalizeMarkdownMath('$a $$b$$ c$')).toBe('$a $$b$$ c$')
    expect(normalizeMarkdownMath('$5 and $x$')).toBe('$5 and $$x$$')
  })

  it('keeps single dollar math untouched inside code', () => {
    const text = '变量 `$HOME/$USER`\n\n```sh\necho $a$b\n```'

    expect(normalizeMarkdownMath(text)).toBe(text)
  })

  it('leaves existing double dollar math and unclosed streaming math alone', () => {
    expect(normalizeMarkdownMath('行内 $$a$$ 与 $b$')).toBe('行内 $$a$$ 与 $$b$$')
    expect(normalizeMarkdownMath('$$\nx = $y$')).toBe('$$\nx = $y$')
    expect(normalizeMarkdownMath('正在输出 $x')).toBe('正在输出 $x')
  })

  it('promotes a standalone double dollar line to display math', () => {
    expect(normalizeMarkdownMath('其中\n$$ E=mc^2 $$\n成立')).toBe('其中\n$$\nE=mc^2\n$$\n成立')
    expect(normalizeMarkdownMath('> $$x^2$$')).toBe('> $$\n> x^2\n> $$')
    expect(normalizeMarkdownMath('- 项\n  $$x$$')).toBe('- 项\n  $$\n  x\n  $$')
  })

  it('keeps standalone inline-delimited math inline', () => {
    expect(normalizeMarkdownMath('\\(x\\)')).toBe('$$x$$')
    expect(normalizeMarkdownMath('$x$')).toBe('$$x$$')
    expect(normalizeMarkdownMath('`code` $$x$$')).toBe('`code` $$x$$')
  })
})
