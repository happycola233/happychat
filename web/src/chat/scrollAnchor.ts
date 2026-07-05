export interface ViewportAnchorCandidate {
  element: HTMLElement
  viewportOffsetTop: number
}

export interface ViewportScrollSnapshot {
  autoFollowing: boolean
  scrollTop: number
  anchors: ViewportAnchorCandidate[]
}

/** 根据同一锚点更新前后的视口偏移，计算无需动画的补偿滚动位置。 */
export function resolveAnchoredScrollTop(
  currentScrollTop: number,
  previousViewportOffsetTop: number,
  currentViewportOffsetTop: number,
  maxScrollTop: number,
): number {
  const anchoredScrollTop = currentScrollTop + currentViewportOffsetTop - previousViewportOffsetTop
  return Math.min(Math.max(0, anchoredScrollTop), Math.max(0, maxScrollTop))
}

export interface NearestTargetScrollArgs {
  currentScrollTop: number
  scrollHeight: number
  clientHeight: number
  containerTop: number
  containerBottom: number
  targetTop: number
  targetBottom: number
  insetTop?: number
  insetBottom?: number
}

/** 只滚动到“刚好看见目标”的位置，避免锚点跳转把靠后的脚注强行居中。 */
export function resolveNearestTargetScrollTop(args: NearestTargetScrollArgs): number {
  const visibleTop = args.containerTop + (args.insetTop ?? 0)
  const visibleBottom = args.containerBottom - (args.insetBottom ?? 0)
  let nextScrollTop = args.currentScrollTop

  if (args.targetTop < visibleTop) {
    nextScrollTop += args.targetTop - visibleTop
  } else if (args.targetBottom > visibleBottom) {
    nextScrollTop += args.targetBottom - visibleBottom
  }

  const maxScrollTop = Math.max(0, args.scrollHeight - args.clientHeight)
  return Math.min(Math.max(0, nextScrollTop), maxScrollTop)
}

function firstVisibleMessage(scrollElement: HTMLElement): HTMLElement | null {
  const scrollRect = scrollElement.getBoundingClientRect()
  return (
    Array.from(scrollElement.querySelectorAll<HTMLElement>('[data-scroll-anchor]')).find(
      (element) => {
        const rect = element.getBoundingClientRect()
        return rect.bottom > scrollRect.top && rect.top < scrollRect.bottom
      },
    ) ?? null
  )
}

/**
 * 在终态文本替换前捕获当前视口中的真实 DOM 锚点。
 * 保存从最深层文本块到消息容器的候选链，Markdown 结构变化时可逐级回退。
 */
export function captureViewportScroll(
  scrollElement: HTMLElement,
  autoFollowing: boolean,
): ViewportScrollSnapshot {
  const scrollRect = scrollElement.getBoundingClientRect()
  const probeX = scrollRect.left + scrollRect.width / 2
  const probeY = Math.min(scrollRect.bottom - 1, scrollRect.top + 8)
  const probedElement = document.elementFromPoint(probeX, probeY)
  let anchorElement =
    probedElement instanceof HTMLElement && scrollElement.contains(probedElement)
      ? probedElement
      : firstVisibleMessage(scrollElement)
  const anchors: ViewportAnchorCandidate[] = []

  while (anchorElement && anchorElement !== scrollElement) {
    anchors.push({
      element: anchorElement,
      viewportOffsetTop: anchorElement.getBoundingClientRect().top - scrollRect.top,
    })
    anchorElement = anchorElement.parentElement
  }

  return {
    autoFollowing,
    scrollTop: scrollElement.scrollTop,
    anchors,
  }
}

/** 在 React 提交 DOM 后、浏览器绘制前恢复捕获的阅读锚点。 */
export function restoreViewportScroll(
  scrollElement: HTMLElement,
  snapshot: ViewportScrollSnapshot,
): void {
  const scrollTop = scrollElement.scrollTop
  const scrollRectTop = scrollElement.getBoundingClientRect().top
  const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight

  for (const anchor of snapshot.anchors) {
    if (!anchor.element.isConnected || !scrollElement.contains(anchor.element)) continue
    const currentViewportOffsetTop = anchor.element.getBoundingClientRect().top - scrollRectTop
    scrollElement.scrollTop = resolveAnchoredScrollTop(
      scrollTop,
      anchor.viewportOffsetTop,
      currentViewportOffsetTop,
      maxScrollTop,
    )
    return
  }

  // 极端情况下 Markdown 结构整体替换，至少保持原绝对位置，绝不强制跳到底部。
  scrollElement.scrollTop = Math.min(Math.max(0, snapshot.scrollTop), Math.max(0, maxScrollTop))
}
