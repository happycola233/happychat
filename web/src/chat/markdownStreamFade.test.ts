import rehypeStringify from 'rehype-stringify'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { MARKDOWN_REMARK_PLUGINS } from './markdownRemarkPlugins'
import {
  createStreamFadeState,
  rehypeStreamFade,
  settleStreamFade,
  type StreamFadeState,
} from './markdownStreamFade'

function render(markdown: string, state: StreamFadeState): string {
  return unified()
    .use(remarkParse)
    .use(MARKDOWN_REMARK_PLUGINS)
    .use(remarkRehype)
    .use(rehypeStreamFade, state)
    .use(rehypeStringify)
    .processSync(markdown)
    .toString()
}

const seg = (text: string) => `<span class="hc-stream-seg">${text}</span>`

describe('rehypeStreamFade', () => {
  it('每次渲染新到达的文字各自成段，已有分段保持不变', () => {
    const state = createStreamFadeState()

    expect(render('你好', state)).toBe(`<p>${seg('你好')}</p>`)
    expect(render('你好 world', state)).toBe(`<p>${seg('你好')}${seg(' world')}</p>`)
    // 同一文本重复渲染（如 StrictMode 双调用）结果不变，也不会多出空分段。
    expect(render('你好 world', state)).toBe(`<p>${seg('你好')}${seg(' world')}</p>`)
  })

  it('分段跨越行内元素时逐个文本节点包裹，代码与纯空白不包裹', () => {
    const state = createStreamFadeState()
    render('看', state)

    expect(render('看 `code` **重点**\n\n- a\n- b', state)).toBe(
      `<p>${seg('看')} <code>code</code> <strong>${seg('重点')}</strong></p>\n` +
        `<ul>\n<li>${seg('a')}</li>\n<li>${seg('b')}</li>\n</ul>`,
    )
  })

  it('收拢后已有文字转为纯文本，之后只有新文字渐入', () => {
    const state = createStreamFadeState()
    render('第一句。', state)
    render('第一句。第二句。', state)

    expect(settleStreamFade(state)).toBe(true)
    expect(render('第一句。第二句。', state)).toBe('<p>第一句。第二句。</p>')
    expect(settleStreamFade(state)).toBe(false)
    expect(render('第一句。第二句。第三句。', state)).toBe(
      `<p>第一句。第二句。${seg('第三句。')}</p>`,
    )
  })

  it('Markdown 结构变化导致文字变短时丢弃越界的分段边界', () => {
    const state = createStreamFadeState()
    render('**粗', state)
    render('**粗体', state)

    expect(render('**粗体**', state)).toBe(`<p><strong>${seg('粗体')}</strong></p>`)
    expect(state.chunkEnds).toEqual([2])
  })
})
