import { clsx } from 'clsx'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarStore,
} from '../store/sidebar'

const CHAT_MIN_WIDTH = 480

interface SidebarDrag {
  pointerId: number
  startX: number
  startWidth: number
  width: number
}

/** 拖动中的宽度只更新外壳，避免每次移动都重渲染会话列表并写入 localStorage。 */
export function SidebarFrame({
  railMode,
  isMobile,
  mobileOpen,
  children,
}: {
  railMode: boolean
  isMobile: boolean
  mobileOpen: boolean
  children: ReactNode
}) {
  const savedWidth = useSidebarStore((state) => state.width)
  const setWidth = useSidebarStore((state) => state.setWidth)
  const sidebarRef = useRef<HTMLElement>(null)
  const dragRef = useRef<SidebarDrag | null>(null)
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const [pointerFocused, setPointerFocused] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const resizable = !isMobile && !railMode
  const resizing = resizable && draftWidth !== null
  const maxWidth = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - CHAT_MIN_WIDTH),
  )
  const clampWidth = (width: number) =>
    Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth, width)))
  const width = clampWidth(draftWidth ?? savedWidth)

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth)
      dragRef.current = null
      setDraftWidth(null)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!resizable) {
      dragRef.current = null
      setDraftWidth(null)
    }
  }, [resizable])

  useEffect(() => {
    if (!resizing) return
    document.documentElement.classList.add('hc-sidebar-resizing')
    return () => document.documentElement.classList.remove('hc-sidebar-resizing')
  }, [resizing])

  const cancelResize = () => {
    dragRef.current = null
    setDraftWidth(null)
  }

  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.width = clampWidth(drag.startWidth + event.clientX - drag.startX)
    setDraftWidth(drag.width)
  }

  return (
    <aside
      id="chat-sidebar"
      ref={sidebarRef}
      aria-label="侧边栏"
      style={{
        width: isMobile ? 280 : railMode ? 48 : width,
        transitionDuration: resizing ? '0ms' : undefined,
      }}
      className={clsx(
        'flex h-full shrink-0 flex-col border-r border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-[#000000] dark:text-neutral-100',
        'md:relative md:translate-x-0 md:shadow-none md:transition-[width,background-color,border-color] md:duration-300 md:ease-[cubic-bezier(0.22,1,0.36,1)]',
        railMode ? 'md:overflow-visible' : 'overflow-hidden',
        'fixed inset-y-0 left-0 z-50 transition-transform duration-300 motion-reduce:transition-none md:motion-reduce:transition-none',
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
      )}
    >
      {children}
      {resizable && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="侧边栏"
          aria-controls="chat-sidebar"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          aria-valuetext={`${width} 像素`}
          title="拖动调整宽度，双击恢复默认"
          className={clsx(
            'absolute inset-y-0 right-0 z-50 w-2 cursor-col-resize touch-none select-none outline-none',
            'before:absolute before:inset-y-0 before:right-0 before:w-0.5 before:transition-colors',
            'hover:before:bg-neutral-400 dark:hover:before:bg-neutral-500',
            !pointerFocused &&
              'focus-visible:before:bg-sky-500 dark:focus-visible:before:bg-sky-400',
            resizing && 'before:bg-neutral-400 dark:before:bg-neutral-500',
          )}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return
            // 同一元素从键盘切回鼠标时，浏览器可能保留 :focus-visible；指针操作期间不显示键盘高亮。
            setPointerFocused(true)
            event.currentTarget.setPointerCapture(event.pointerId)
            // 展开动画尚未结束时，从当前可见边缘开始，避免手柄突然跳到目标宽度。
            const startWidth = sidebarRef.current!.getBoundingClientRect().width
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startWidth,
              width: clampWidth(startWidth),
            }
            setDraftWidth(clampWidth(startWidth))
          }}
          onPointerMove={moveResize}
          onPointerUp={(event) => {
            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return
            moveResize(event)
            setWidth(drag.width)
            cancelResize()
          }}
          onPointerCancel={cancelResize}
          onLostPointerCapture={cancelResize}
          onDoubleClick={() => setWidth(SIDEBAR_DEFAULT_WIDTH)}
          onBlur={() => setPointerFocused(false)}
          onKeyDown={(event) => {
            setPointerFocused(false)
            if (event.key === 'Escape' && resizing) {
              event.preventDefault()
              cancelResize()
              return
            }
            const step = event.shiftKey ? 32 : 8
            let nextWidth: number
            switch (event.key) {
              case 'ArrowLeft':
                nextWidth = width - step
                break
              case 'ArrowRight':
                nextWidth = width + step
                break
              case 'Home':
                nextWidth = SIDEBAR_MIN_WIDTH
                break
              case 'End':
                nextWidth = maxWidth
                break
              default:
                return
            }
            event.preventDefault()
            setWidth(clampWidth(nextWidth))
          }}
        />
      )}
    </aside>
  )
}
