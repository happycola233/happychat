import type { Nodes } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { MARKDOWN_REMARK_PLUGINS } from './markdownRemarkPlugins'

const blockParser = unified().use(remarkParse).use(MARKDOWN_REMARK_PLUGINS).freeze()

export interface StreamingBlockSplitter {
  /**
   * 把流式 Markdown 切成顶层块，各块按顺序拼接后与原文完全相同；只有最后一块还可能继续生长。
   * 文本含链接引用或脚注定义时返回 null：定义会改变其它块的渲染结果，只能整篇解析。
   */
  split(text: string): string[] | null
}

function containsDefinition(node: Nodes): boolean {
  if (node.type === 'definition' || node.type === 'footnoteDefinition') return true
  // 定义只会出现在块级容器里，不必深入段落、标题、表格等行内内容。
  if (node.type !== 'blockquote' && node.type !== 'list' && node.type !== 'listItem') return false
  return node.children.some(containsDefinition)
}

function lineStartOf(text: string, offset: number): number {
  return offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1
}

/**
 * 流式文本只会在末尾追加，而 CommonMark 的块一旦闭合就不会被后续文本改写：
 * 已闭合的顶层块可以冻结并各自缓存渲染结果，每次增量只需重新解析仍在生长的最后一块，
 * 单次更新成本从 O(全文) 降到 O(最后一块)。
 *
 * 例外：链接引用/脚注定义作用于全文，出现后整篇退回单块解析；HTML 块可能包裹之后的
 * Markdown（如 `<details>`），从它开始的内容不再切分。文本若被改写而非追加，则从头重新切分。
 */
export function createStreamingBlockSplitter(): StreamingBlockSplitter {
  let settledSource = ''
  let settledBlocks: string[] = []

  return {
    split(text) {
      if (!text.startsWith(settledSource)) {
        settledSource = ''
        settledBlocks = []
      }
      const tail = text.slice(settledSource.length)
      // remark-parse 总会为节点写入源码位置，下面的 position/offset 断言不会落空。
      const children = blockParser.parse(tail).children
      if (children.some(containsDefinition)) return null

      let cut = 0
      for (let index = 0; index < children.length - 1; index += 1) {
        if (children[index]!.type === 'html') break
        // 块边界取下一块所在行的行首，保留其缩进，切出的块单独解析时结构不变。
        const nextStart = lineStartOf(tail, children[index + 1]!.position!.start.offset!)
        settledBlocks.push(tail.slice(cut, nextStart))
        cut = nextStart
      }
      settledSource += tail.slice(0, cut)
      return [...settledBlocks, tail.slice(cut)]
    },
  }
}
