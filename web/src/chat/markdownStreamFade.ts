import type { Element, ElementContent, Root } from 'hast'

// 新到达文字的包裹类名；淡入动画定义见 index.css 的 .hc-stream-seg。
const SEGMENT_CLASS = 'hc-stream-seg'

// 代码块 / 行内代码 / 公式 / 矢量图内部不拆分：保留原节点，避免破坏高亮、KaTeX 与语义。
const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style', 'svg', 'math'])

function classList(node: Element): string[] {
  const value = node.properties?.className
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string') return value.split(/\s+/)
  return []
}

function shouldSkip(node: Element): boolean {
  if (SKIP_TAGS.has(node.tagName)) return true
  // rehype-katex 产出的公式根节点带 katex / katex-display 等类名，整棵跳过。
  return classList(node).some((name) => name === 'katex' || name.startsWith('katex-'))
}

// 把一段文本切成「可见单元」：连续空白保持纯文本，ASCII 单词整体成段，其余按单个码点成段。
const UNIT_RE = /(\s+)|([A-Za-z0-9]+(?:[-'’][A-Za-z0-9]+)*)|(.)/gsu

export interface VisibleUnit {
  chunk: string
  /** 连续空白：保持纯文本不包裹，与原文完全一致的换行/折行行为。 */
  isSpace: boolean
}

/** 可见单元切分（CJK 逐字、ASCII 整词），供思考卡小标题逐字错峰扫入。 */
export function splitVisibleUnits(value: string): VisibleUnit[] {
  const units: VisibleUnit[] = []
  for (const match of value.matchAll(UNIT_RE)) {
    units.push({ chunk: match[0], isSpace: Boolean(match[1]) })
  }
  return units
}

/**
 * 单个流式 Markdown 块的渐入进度，偏移量按「可渐入文字」计数（跳过代码与公式）。
 *
 * 同一次流式更新到达的文字包进同一个 span：React 只挂载最新一段，旧段保持原节点、不重播动画；
 * 相比逐字包裹，DOM 节点与同时运行的动画（各占一个合成层）都从「字数」级降到「更新次数」级。
 */
export interface StreamFadeState {
  /** 已播完渐入、按纯文本渲染的前缀长度。 */
  plainLength: number
  /** plainLength 之后每次渲染结束时的文字长度（递增），相邻边界之间是同一次更新的文字。 */
  chunkEnds: number[]
  /** 最近一次渲染的文字总长。 */
  renderedLength: number
}

export function createStreamFadeState(): StreamFadeState {
  return { plainLength: 0, chunkEnds: [], renderedLength: 0 }
}

/**
 * 块停止变化且动画已播完后调用：把已有文字全部转为纯文本，释放渐入 span。
 * 返回是否有 span 需要通过重渲染移除；之后若块继续生长，只有新文字会渐入。
 */
export function settleStreamFade(state: StreamFadeState): boolean {
  if (state.plainLength >= state.renderedLength) return false
  state.plainLength = state.renderedLength
  state.chunkEnds = []
  return true
}

function textPiece(value: string): ElementContent {
  // 纯空白保持文本节点：列表、表格等容器的子节点间只有空白，包成 span 会破坏 DOM 结构。
  if (!value.trim()) return { type: 'text', value }
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [SEGMENT_CLASS] },
    children: [{ type: 'text', value }],
  }
}

/**
 * rehype 插件：按 state 记录的更新边界，把每次新到达的文字包成 <span class="hc-stream-seg">，
 * 配合 CSS 逐段淡入，替代打字光标。需放在 rehype-katex / rehype-highlight 之后运行。
 *
 * 渲染时会把本次文字长度记为新的边界；同一文本重复渲染（如 StrictMode 双调用）结果不变。
 */
export function rehypeStreamFade(state: StreamFadeState) {
  return (tree: Root): void => {
    const { chunkEnds } = state
    let offset = 0
    // 文本节点按文档顺序访问、偏移单调递增，边界指针只需前移。
    let boundaryIndex = 0

    const splitText = (value: string): ElementContent[] => {
      const start = offset
      const end = start + value.length
      offset = end
      const pieces: ElementContent[] = []
      let cursor = start
      const plainEnd = Math.min(end, state.plainLength)
      if (plainEnd > cursor) {
        pieces.push({ type: 'text', value: value.slice(0, plainEnd - start) })
        cursor = plainEnd
      }
      while (boundaryIndex < chunkEnds.length && chunkEnds[boundaryIndex]! <= cursor) {
        boundaryIndex += 1
      }
      while (boundaryIndex < chunkEnds.length && chunkEnds[boundaryIndex]! < end) {
        const boundary = chunkEnds[boundaryIndex]!
        pieces.push(textPiece(value.slice(cursor - start, boundary - start)))
        cursor = boundary
        boundaryIndex += 1
      }
      if (cursor < end) pieces.push(textPiece(value.slice(cursor - start)))
      return pieces
    }

    const wrapChildren = (children: ElementContent[]): ElementContent[] =>
      children.flatMap((child) => {
        if (child.type === 'text') return splitText(child.value)
        if (child.type === 'element' && !shouldSkip(child)) {
          child.children = wrapChildren(child.children)
        }
        return [child]
      })

    // 本管线里 Root 的直接子节点均为块级元素/文本，可安全按 ElementContent 处理。
    tree.children = wrapChildren(tree.children as ElementContent[])

    // 文字因 Markdown 结构变化而变短时丢弃越界边界，再记下本次长度作为下一段的起点。
    while ((chunkEnds.at(-1) ?? 0) > offset) chunkEnds.pop()
    if (offset > Math.max(state.plainLength, chunkEnds.at(-1) ?? 0)) chunkEnds.push(offset)
    state.renderedLength = offset
  }
}
