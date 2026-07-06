import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Markdown code blocks', () => {
  it('shows the fenced code language in the code block header', () => {
    const html = renderToStaticMarkup(<Markdown text={'```bash\narchive/codex-prototype\n```'} />)

    expect(html).toContain('Bash')
    expect(html).toContain('aria-label="复制代码"')
    expect(html).toContain('archive/codex-prototype')
    expect(html).toContain('hc-code-block')
  })

  it('shows Text for code blocks without a language', () => {
    const html = renderToStaticMarkup(<Markdown text={'```\nplain\n```'} />)

    expect(html).toContain('Text')
  })
})

describe('Markdown tables', () => {
  it('renders tables with the shared table block and copy action', () => {
    const html = renderToStaticMarkup(
      <Markdown text={'| 项目 | 内容 |\n| --- | --- |\n| 主题 | 你想整理的内容 |'} />,
    )

    expect(html).toContain('hc-table-block')
    expect(html).toContain('aria-label="复制表格"')
    expect(html).toContain('opacity-0')
    expect(html).toContain('group-hover/table:opacity-100')
    expect(html).toContain('<th>项目</th>')
    expect(html).toContain('<td>你想整理的内容</td>')
  })
})

describe('Markdown footnotes', () => {
  it('keeps footnote anchors on the current page and preserves generated metadata', () => {
    const html = renderToStaticMarkup(<Markdown text={'正文[^time]\n\n[^time]: 脚注内容。'} />)

    expect(html).toContain('class="footnotes"')
    expect(html).toContain('data-footnote-ref')
    expect(html).toContain('aria-describedby="footnote-label"')
    expect(html).toContain('data-footnote-backref')
    expect(html).toContain('aria-label="返回正文 1"')
    expect(html).toContain('↩')
    expect(html).toContain('text-neutral-400')
    expect(html).toMatch(/href="#[^"]*fn-time"/)
    expect(html).toMatch(/id="[^"]*fnref-time"/)
    expect(html).not.toMatch(/href="#[^"]*" target="_blank"/)
  })

  it('still opens ordinary markdown links in a new tab', () => {
    const html = renderToStaticMarkup(<Markdown text={'[OpenAI](https://openai.com)'} />)

    expect(html).toContain('href="https://openai.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
  })
})

describe('Markdown math', () => {
  it('renders LaTeX display delimiters through KaTeX', () => {
    const html = renderToStaticMarkup(<Markdown text={'\\[ x=\\frac{1}{2} \\]'} />)

    expect(html).toContain('katex-display')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('[ x=\\frac')
  })

  it('renders LaTeX inline delimiters through KaTeX', () => {
    const html = renderToStaticMarkup(<Markdown text={'这是 \\( a+b \\) 公式'} />)

    expect(html).toContain('katex')
    expect(html).not.toContain('\\( a+b \\)')
  })

  it('renders display math inside one continuous blockquote', () => {
    const text = [
      '幂级数里不要写成“规定 \\(0^0=1\\)”，更严谨应该写成：',
      '',
      '> 在幂级数  ',
      '> \\[',
      '> \\sum_{n=0}^{\\infty}a_n(x-x_0)^n',
      '> \\]',
      '> 中，**第 \\(n=0\\) 项按常数项 \\(a_0\\) 处理**，即 \\((x-x_0)^0\\) 视为 \\(1\\)。  ',
      '> 因此当 \\(x=x_0\\) 时，',
      '> \\[',
      '> \\sum_{n=0}^{\\infty}a_n(x-x_0)^n=a_0.',
      '> \\]',
      '> 但这不等于说一般情况下 \\(0^0=1\\)。',
    ].join('\n')
    const html = renderToStaticMarkup(<Markdown text={text} />)

    expect(html.match(/<blockquote>/g)).toHaveLength(1)
    expect(html.match(/katex-display/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('<strong>第 ')
    expect(html).not.toContain('&gt;')
  })

  it('keeps dollar amounts as text instead of parsing them as math', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const text =
      '报价约 **$64,928**，24h 跌约 **2.52%**，高低约 **$66,754 / $64,796**，市值约 **$1.30T**。'
    const html = renderToStaticMarkup(<Markdown text={text} />)

    expect(html).not.toContain('katex')
    expect(html).toContain('$64,928')
    expect(html).toContain('2.52%')
    expect(html).toContain('$66,754 / $64,796')
    expect(html).toContain('$1.30T')
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('Markdown 流式渐入', () => {
  it('animate 时把正文按可见单元包成 hc-stream-seg（CJK 逐字、ASCII 整词）', () => {
    const html = renderToStaticMarkup(<Markdown text={'你好 world'} animate />)

    expect(html).toMatch(/<span class="hc-stream-seg">你<\/span>/)
    expect(html).toMatch(/<span class="hc-stream-seg">好<\/span>/)
    // ASCII 单词整体成段，不逐字拆开。
    expect(html).toMatch(/<span class="hc-stream-seg">world<\/span>/)
    expect(html).not.toContain('>w</span>')
  })

  it('默认（非流式）不包裹，正文保持连续文本', () => {
    const html = renderToStaticMarkup(<Markdown text={'你好世界'} />)

    expect(html).not.toContain('hc-stream-seg')
    expect(html).toContain('你好世界')
  })

  it('animate 时跳过代码块，只对普通文字渐入', () => {
    const html = renderToStaticMarkup(<Markdown text={'看 `code` 这里'} animate />)

    // 行内代码原样保留，内部不拆分。
    expect(html).toContain('<code>code</code>')
    expect(html).toMatch(/<span class="hc-stream-seg">看<\/span>/)
    expect(html).toMatch(/<span class="hc-stream-seg">这<\/span>/)
  })
})

// 公告正文复用同一渲染器（作者为管理员，但仍须保证不执行不可信 HTML）。
describe('Markdown 安全性', () => {
  it('不把原始 HTML 渲染为真实的脚本/图片标签', () => {
    const html = renderToStaticMarkup(
      <Markdown text={'<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n正文照常'} />,
    )

    // 未启用 rehype-raw：原始 HTML 被转义为文本，绝不产生可执行标签。
    expect(html).not.toContain('<script>')
    expect(html).not.toMatch(/<img[\s>]/)
    expect(html).toContain('正文照常')
  })

  it('中和 javascript: 链接协议', () => {
    const html = renderToStaticMarkup(<Markdown text={'[点我](javascript:alert(1))'} />)

    expect(html).not.toContain('javascript:')
    expect(html).toContain('点我')
  })
})
