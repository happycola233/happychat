import { describe, expect, it } from 'vitest'
import { createStreamingBlockSplitter } from './markdownStreamBlocks'

const RICH_MARKDOWN = [
  '# 标题',
  '第一段 **粗体** 与 `code`。\n同一段的第二行',
  '- 列表一\n\n- 列表二\n  - 嵌套\n\n  缩进续段',
  '| 列 | 值 |\n| --- | --- |\n| a | 1 |',
  '```ts\nconst a = 1\n\nconst b = 2\n```',
  '$$\nE = mc^2\n\n$$',
  '> 引用\n懒惰续行\n\n> 第二个引用',
  '    缩进代码\n\n    仍是代码',
  '末段\n===',
  '---',
  '1. 有序\n2. 列表',
].join('\n\n')

describe('createStreamingBlockSplitter', () => {
  it('按顶层块切分，拼接后与原文一致，最后一块留给继续生长', () => {
    const blocks = createStreamingBlockSplitter().split('第一段\n\n- a\n- b\n\n  续段\n\n第三段')

    expect(blocks).toEqual(['第一段\n\n', '- a\n- b\n\n  续段\n\n', '第三段'])
  })

  it('逐字追加时与每次从头切分的结果一致', () => {
    const incremental = createStreamingBlockSplitter()
    for (let length = 0; length <= RICH_MARKDOWN.length; length += 1) {
      const prefix = RICH_MARKDOWN.slice(0, length)
      const blocks = incremental.split(prefix)
      expect(blocks?.join('')).toBe(prefix)
      expect(blocks).toEqual(createStreamingBlockSplitter().split(prefix))
    }
  })

  it('未闭合的代码块与公式块保持为最后一块', () => {
    const splitter = createStreamingBlockSplitter()

    expect(splitter.split('前文\n\n```js\nconst a = 1\n\n')).toEqual([
      '前文\n\n',
      '```js\nconst a = 1\n\n',
    ])
    expect(splitter.split('前文\n\n$$\nx\n\ny')).toEqual(['前文\n\n', '$$\nx\n\ny'])
  })

  it('含链接引用或脚注定义时退回整篇渲染', () => {
    const splitter = createStreamingBlockSplitter()

    expect(splitter.split('见[文档][doc]\n\n后文')).toHaveLength(2)
    expect(splitter.split('见[文档][doc]\n\n后文\n\n[doc]: https://example.com')).toBeNull()
    expect(createStreamingBlockSplitter().split('正文[^1]\n\n> [^1]: 脚注')).toBeNull()
  })

  it('HTML 块及其后的内容合为最后一块', () => {
    const splitter = createStreamingBlockSplitter()

    expect(splitter.split('前文\n\n<details>\n\n内容\n\n</details>\n\n后文')).toEqual([
      '前文\n\n',
      '<details>\n\n内容\n\n</details>\n\n后文',
    ])
  })

  it('文本被改写而非追加时从头重新切分', () => {
    const splitter = createStreamingBlockSplitter()
    splitter.split('第一段\n\n第二段\n\n第三段')

    expect(splitter.split('改写段\n\n第三段')).toEqual(['改写段\n\n', '第三段'])
  })
})
