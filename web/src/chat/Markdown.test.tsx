import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

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
})
