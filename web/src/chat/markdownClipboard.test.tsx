// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'
import {
  cloneSelectionWithWholeFormulas,
  createSelectionClipboardData,
  handleMathCopy,
  markdownClipboardHtml,
} from './markdownClipboard'

const SAMPLE = String.raw`勾股定理 $a^2+b^2=c^2$ 与 \(e^{i\pi}+1=0\)。

$$
\int_0^1 x\,dx = \frac{1}{2}
$$

结尾文字`

const WORD_HTML_ROOT = '<html xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"><body>'

function mount(text: string): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(<Markdown text={text} />)
  return document.body.querySelector('.hc-md')!
}

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  return nodes
}

function select(start: Text, startOffset: number, end: Text, endOffset: number): Selection {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

function selectAll(root: HTMLElement): Selection {
  const nodes = textNodes(root)
  const last = nodes.at(-1)!
  return select(nodes[0]!, 0, last, last.length)
}

function copyEvent() {
  const setData = vi.fn()
  const event = {
    clipboardData: { setData },
    defaultPrevented: false,
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent
  return { event, setData }
}

afterEach(() => {
  document.body.innerHTML = ''
  document.getSelection()?.removeAllRanges()
})

describe('selection copy', () => {
  it('copies formulas as LaTeX source in plain text', () => {
    const fragment = cloneSelectionWithWholeFormulas(selectAll(mount(SAMPLE)))
    const data = createSelectionClipboardData(fragment, true)!

    expect(data.text).toContain('勾股定理 $a^2+b^2=c^2$ 与 $e^{i\\pi}+1=0$。')
    expect(data.text).toContain(String.raw`\int_0^1 x\,dx = \frac{1}{2}`)
    expect(data.text).toContain('$$')
    expect(data.text).toContain('结尾文字')
    // KaTeX 的排版碎片不应混入纯文本。
    expect(data.text).not.toMatch(/a2\s*\+/)
  })

  it('writes Word equations with a LaTeX fallback into html', () => {
    const fragment = cloneSelectionWithWholeFormulas(selectAll(mount(SAMPLE)))
    const html = createSelectionClipboardData(fragment, true)!.html!

    expect(html.startsWith(WORD_HTML_ROOT)).toBe(true)
    expect(html).toContain('<!--[if gte msEquation 12]><m:oMath>')
    expect(html).toContain('<![if !msEquation]>$a^2+b^2=c^2$<![endif]>')
    expect(html).toContain('<p><!--[if gte msEquation 12]><m:oMathPara><m:oMath><m:nary>')
    expect(html).not.toContain('katex')
    expect(html).not.toContain('aria-hidden')
  })

  it('writes plain text only when formatting is turned off', () => {
    selectAll(mount(SAMPLE))
    const { event, setData } = copyEvent()
    handleMathCopy(event, false)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(setData.mock.calls.map(([type]) => type)).toEqual(['text/plain'])
  })

  it('expands a selection that starts or ends inside a formula to the whole formula', () => {
    const root = mount('前 $x+y$ 后')
    const inner = textNodes(root.querySelector('.katex-html')!)[1]!
    const nodes = textNodes(root)
    const fragment = cloneSelectionWithWholeFormulas(select(inner, 0, nodes.at(-1)!, 2))

    expect(createSelectionClipboardData(fragment, true)!.text).toBe('$x+y$ 后')
  })

  it('leaves selections without formulas to the browser', () => {
    const fragment = cloneSelectionWithWholeFormulas(selectAll(mount('普通文字')))
    expect(createSelectionClipboardData(fragment, true)).toBeNull()

    const { event } = copyEvent()
    handleMathCopy(event, true)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('takes over the copy event when the selection contains formulas', () => {
    selectAll(mount(SAMPLE))
    const { event, setData } = copyEvent()
    handleMathCopy(event, true)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(setData.mock.calls.map(([type]) => type)).toEqual(['text/plain', 'text/html'])
  })
})

describe('markdownClipboardHtml', () => {
  it('renders the answer with Word equations and without interface chrome', () => {
    const html = markdownClipboardHtml(
      [
        '## 标题',
        '',
        '- **要点**：$x^2$',
        '',
        '$$ E=mc^2 $$',
        '',
        '```python',
        'print(1)',
        '```',
        '',
        '价格 $5 到 $10',
      ].join('\n'),
    )

    expect(html.startsWith(WORD_HTML_ROOT)).toBe(true)
    expect(html).toContain('<h2>标题</h2>')
    expect(html).toContain('<strong>要点</strong>')
    expect(html).toContain('<![if !msEquation]>$x^2$<![endif]>')
    expect(html).toContain('<p><!--[if gte msEquation 12]><m:oMathPara>')
    expect(html).toContain('<pre><code class="language-python">print(1)\n</code></pre>')
    expect(html).toContain('价格 $5 到 $10')
    expect(html).not.toContain('<button')
  })

  it('keeps the same sanitizing rules as the chat renderer', () => {
    const html = markdownClipboardHtml(
      '<img src="x" onerror="alert(1)"><script>alert(1)</script>正文',
    )

    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script')
    expect(html).toContain('正文')
  })
})
