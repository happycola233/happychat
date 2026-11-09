import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/**
 * 原生 popover 浮层的锚定定位：与触发器右缘对齐，优先放在下方，空间不足时翻到上方，
 * 并随窗口尺寸与任意滚动容器滚动重新计算。浮层进入顶层，不会被表格或滚动区裁切。
 */
export function useAnchoredPopoverPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  preferredWidth: number,
): CSSProperties | undefined {
  const [position, setPosition] = useState<CSSProperties>()

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const trigger = triggerRef.current!.getBoundingClientRect()
      const panel = panelRef.current!
      const padding = 12
      const gap = 8
      const width = Math.min(preferredWidth, window.innerWidth - padding * 2)
      const below = window.innerHeight - trigger.bottom - gap - padding
      const above = trigger.top - gap - padding
      const placeBelow = below >= panel.scrollHeight || below >= above
      setPosition({
        width,
        left: Math.max(
          padding,
          Math.min(trigger.right - width, window.innerWidth - width - padding),
        ),
        top: placeBelow ? trigger.bottom + gap : undefined,
        bottom: placeBelow ? undefined : window.innerHeight - trigger.top + gap,
        maxHeight: Math.max(0, placeBelow ? below : above),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, triggerRef, panelRef, preferredWidth])

  return position
}
