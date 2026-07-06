import type { Element, ElementContent, Root } from 'hast'

// 每个可见单元被包裹后使用的类名；淡入动画定义见 index.css 的 .hc-stream-seg。
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
// 逐段包裹后，仅新到达的 <span> 会在挂载时播放淡入，已存在的文本不会重播动画。
const UNIT_RE = /(\s+)|([A-Za-z0-9]+(?:[-'’][A-Za-z0-9]+)*)|(.)/gsu

export function segmentText(value: string): ElementContent[] {
  const nodes: ElementContent[] = []
  for (const match of value.matchAll(UNIT_RE)) {
    const chunk = match[0]
    if (match[1]) {
      // 空白不包裹，保持与原文完全一致的换行/折行行为。
      nodes.push({ type: 'text', value: chunk })
      continue
    }
    nodes.push({
      type: 'element',
      tagName: 'span',
      properties: { className: [SEGMENT_CLASS] },
      children: [{ type: 'text', value: chunk }],
    })
  }
  return nodes
}

function segmentChildren(children: ElementContent[]): ElementContent[] {
  const next: ElementContent[] = []
  for (const child of children) {
    if (child.type === 'text') {
      next.push(...segmentText(child.value))
      continue
    }
    if (child.type === 'element') {
      if (!shouldSkip(child)) child.children = segmentChildren(child.children)
      next.push(child)
      continue
    }
    next.push(child)
  }
  return next
}

/**
 * rehype 插件：流式渲染时把正文文本按可见单元包成 <span class="hc-stream-seg">，
 * 配合 CSS 让新到达的文字逐段淡入，替代原来的打字光标。
 * 需放在 rehype-katex / rehype-highlight 之后运行，并跳过代码与公式子树。
 */
export function rehypeStreamFade() {
  return (tree: Root): void => {
    // 本管线里 Root 的直接子节点均为块级元素/文本，可安全按 ElementContent 处理。
    tree.children = segmentChildren(tree.children as ElementContent[])
  }
}
