import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type RowMenuPlacement = 'top' | 'bottom'

// 移动布局和触控设备没有可靠的 hover：仅在桌面宽度且支持悬停时收起操作入口。
export const HOVER_REVEAL_CLASS =
  'opacity-100 md:[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
export const HOVER_ACTION_PADDING_CLASS =
  'pr-7 md:[@media(hover:hover)]:pr-0 group-hover:pr-7 group-focus-within:pr-7'
/** HOVER_REVEAL 的反相：桌面悬停时让位给操作按钮的元素（如文件夹计数）。 */
export const HOVER_CONCEAL_CLASS =
  'opacity-0 md:[@media(hover:hover)]:opacity-100 group-hover:opacity-0 group-focus-within:opacity-0'

const ROW_MENU_GAP_PX = 4
/** 打开瞬间菜单尚未渲染时的高度估计（约 5 个条目），随后由实测高度校正。 */
const ROW_MENU_ESTIMATED_HEIGHT_PX = 216

function findScrollBoundaryElement(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (/(auto|scroll|overlay)/.test(overflowY)) return parent
    parent = parent.parentElement
  }
  return null
}

function rowMenuPlacement(
  row: HTMLElement,
  menuHeight = ROW_MENU_ESTIMATED_HEIGHT_PX,
): RowMenuPlacement {
  const rowRect = row.getBoundingClientRect()
  const boundaryRect = findScrollBoundaryElement(row)?.getBoundingClientRect()
  const boundaryTop = boundaryRect?.top ?? 0
  const boundaryBottom = boundaryRect?.bottom ?? window.innerHeight
  const spaceAbove = rowRect.top - boundaryTop - ROW_MENU_GAP_PX
  const spaceBelow = boundaryBottom - rowRect.bottom - ROW_MENU_GAP_PX

  return spaceBelow < menuHeight && spaceAbove > spaceBelow ? 'top' : 'bottom'
}

/**
 * 侧栏行内三点菜单的通用状态：外点/Escape 关闭 + 依据滚动容器空间上下翻转。
 * 会话行与文件夹行共用；`remeasureKey` 变化时重估位置（菜单切换视图导致高度变化）。
 */
export function useRowMenu(remeasureKey?: unknown) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPlacement, setMenuPlacement] = useState<RowMenuPlacement>('bottom')
  const menuRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (menuRef.current?.contains(t) || rowRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useLayoutEffect(() => {
    if (!menuOpen) return undefined
    const row = rowRef.current
    if (!row) return undefined

    const syncPlacement = () => {
      setMenuPlacement(rowMenuPlacement(row, menuRef.current?.offsetHeight))
    }
    syncPlacement()

    const scrollBoundary = findScrollBoundaryElement(row)
    window.addEventListener('resize', syncPlacement)
    scrollBoundary?.addEventListener('scroll', syncPlacement, { passive: true })
    return () => {
      window.removeEventListener('resize', syncPlacement)
      scrollBoundary?.removeEventListener('scroll', syncPlacement)
    }
  }, [menuOpen, remeasureKey])

  const toggleMenu = () => {
    if (!menuOpen && rowRef.current) {
      setMenuPlacement(rowMenuPlacement(rowRef.current))
    }
    setMenuOpen((open) => !open)
  }

  return { menuOpen, setMenuOpen, menuPlacement, menuRef, rowRef, toggleMenu }
}
