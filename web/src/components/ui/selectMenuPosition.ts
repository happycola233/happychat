export type SelectMenuPlacement = 'below' | 'above'

export interface SelectMenuRect {
  top: number
  left: number
  bottom: number
  width: number
}

export interface SelectMenuCoords {
  left: number
  width: number
  maxHeight: number
  placement: SelectMenuPlacement
  top?: number
  bottom?: number
}

const DEFAULT_GAP = 6
const DEFAULT_PADDING = 8
const DEFAULT_MAX_HEIGHT = 280
const DEFAULT_MAX_WIDTH = 360

/**
 * 把下拉面板钉在触发器附近：优先下方，空间不够再翻到上方，
 * 并钳制在视口内，避免被管理页滚动区或弹窗 overflow 裁切。
 */
export function placeSelectMenu({
  trigger,
  viewport,
  contentHeight,
  menuWidth,
  gap = DEFAULT_GAP,
  padding = DEFAULT_PADDING,
  maxHeight = DEFAULT_MAX_HEIGHT,
  maxWidth = DEFAULT_MAX_WIDTH,
}: {
  trigger: SelectMenuRect
  viewport: { width: number; height: number }
  contentHeight: number
  /** 未测量前按触发器宽度；测量后取内容与触发器的较大值。 */
  menuWidth?: number
  gap?: number
  padding?: number
  maxHeight?: number
  maxWidth?: number
}): SelectMenuCoords {
  const spaceBelow = viewport.height - trigger.bottom - gap - padding
  const spaceAbove = trigger.top - gap - padding
  const desired = Math.min(maxHeight, Math.max(contentHeight, 0))
  const placement: SelectMenuPlacement =
    spaceBelow >= desired || spaceBelow >= spaceAbove ? 'below' : 'above'
  const available = Math.max(0, placement === 'below' ? spaceBelow : spaceAbove)

  // 高度上限用「视口剩余 / 设计上限」，不要钉成内容高度：
  // 钉成内容高度时 border-box + 滚动条会再吃掉几个像素，短列表也会出现滚动条并把文字挤省略。
  const width = Math.min(
    Math.max(trigger.width, menuWidth ?? trigger.width, 0),
    Math.min(maxWidth, Math.max(0, viewport.width - padding * 2)),
  )
  let left = trigger.left
  if (left + width > viewport.width - padding) left = viewport.width - padding - width
  if (left < padding) left = padding

  return {
    left,
    width,
    maxHeight: Math.min(maxHeight, available),
    placement,
    ...(placement === 'below'
      ? { top: trigger.bottom + gap }
      : { bottom: viewport.height - trigger.top + gap }),
  }
}
