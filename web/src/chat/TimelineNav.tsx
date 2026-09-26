import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { Bookmark } from 'lucide-react'
import { clsx } from 'clsx'
import type { TimelineNavPosition } from '@shared/types/domain'
import {
  resolveActiveTimelineId,
  TIMELINE_JUMP_OFFSET_PX,
  type TimelineItem,
} from './timelineItems'
import { Markdown } from './Markdown'
import { useMessageBookmark } from '../hooks/useMessageBookmark'
import './timeline.css'

const COLLAPSE_DELAY_MS = 160
const RAIL_HEIGHT_BUDGET_PX = 440

interface Props {
  conversationId: string
  position: TimelineNavPosition
  items: TimelineItem[]
  scrollContainerRef: RefObject<HTMLDivElement | null>
  onJump: (messageId: string) => void
}

/** 一轮一刻度；悬停只预览这一轮，阅读位置与悬停位置独立。 */
export function TimelineNav({
  conversationId,
  position,
  items,
  scrollContainerRef,
  onJump,
}: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const collapseTimerRef = useRef<number | null>(null)
  const previewDomId = useId()
  const bookmark = useMessageBookmark(conversationId)
  const previewIndex = items.findIndex((item) => item.id === previewId)
  const preview = items[previewIndex]
  const activeIndex = items.findIndex((item) => item.id === activeId)
  const currentGroupStart = Math.max(0, Math.min(items.length - 3, activeIndex - 1))

  const cancelCollapse = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
  }, [])

  const closePreview = useCallback(() => {
    cancelCollapse()
    setPreviewId(null)
  }, [cancelCollapse])

  const scheduleCollapse = () => {
    cancelCollapse()
    collapseTimerRef.current = window.setTimeout(closePreview, COLLAPSE_DELAY_MS)
  }

  const showPreview = (id: string) => {
    cancelCollapse()
    setPreviewId(id)
  }

  useEffect(() => cancelCollapse, [cancelCollapse])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    let frame: number | null = null
    const syncActive = () => {
      frame = null
      const containerTop = container.getBoundingClientRect().top
      const tops = new Map<string, number>()
      for (const element of container.querySelectorAll<HTMLElement>('[data-scroll-anchor]')) {
        tops.set(
          element.dataset.scrollAnchor!,
          element.getBoundingClientRect().top - containerTop + container.scrollTop,
        )
      }
      const anchors = items.flatMap((item) => {
        const top = tops.get(item.id)
        return top === undefined ? [] : [{ id: item.id, top }]
      })
      setActiveId(
        resolveActiveTimelineId(
          anchors,
          container.scrollTop,
          container.clientHeight,
          container.scrollHeight,
          // 激活线紧跟跳转落点，避免大屏里短回复使高亮误移到下一轮。
          Math.min(0.35, (TIMELINE_JUMP_OFFSET_PX + 20) / container.clientHeight),
        ),
      )
    }
    const scheduleSync = () => {
      if (frame === null) frame = requestAnimationFrame(syncActive)
    }
    syncActive()
    container.addEventListener('scroll', scheduleSync, { passive: true })
    const observer = new ResizeObserver(scheduleSync)
    observer.observe(container)
    // 图片加载、过程轨折叠与流式回复都会改变锚点位置，即使此刻没有滚动。
    if (container.firstElementChild) observer.observe(container.firstElementChild)
    return () => {
      container.removeEventListener('scroll', scheduleSync)
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [items, scrollContainerRef])

  useEffect(() => {
    if (!preview && activeId) {
      railRef.current
        ?.querySelector<HTMLElement>(`[data-timeline-item="${CSS.escape(activeId)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeId, preview])

  const positionPreview = useCallback(() => {
    const nav = navRef.current
    const rail = railRef.current
    const card = previewRef.current
    const tick = rail?.querySelector<HTMLElement>(
      `[data-timeline-item="${CSS.escape(previewId ?? '')}"]`,
    )
    if (!nav || !rail || !card || !tick) return
    const navBounds = nav.getBoundingClientRect()
    const railBounds = rail.getBoundingClientRect()
    const tickBounds = tick.getBoundingClientRect()
    const availableWidth =
      position === 'left' ? window.innerWidth - navBounds.right - 24 : navBounds.left - 24
    card.style.width = `${Math.min(384, availableWidth)}px`
    const center = Math.max(
      railBounds.top,
      Math.min(railBounds.bottom, tickBounds.top + tickBounds.height / 2),
    )
    const top = Math.max(
      12,
      Math.min(window.innerHeight - card.offsetHeight - 12, center - card.offsetHeight / 2),
    )
    card.style.top = `${top - navBounds.top}px`
  }, [previewId, position])

  useLayoutEffect(() => {
    if (!preview) return
    positionPreview()
    const observer = new ResizeObserver(positionPreview)
    observer.observe(previewRef.current!)
    observer.observe(navRef.current!)
    window.addEventListener('resize', positionPreview)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', positionPreview)
    }
  }, [preview, positionPreview])

  useEffect(() => {
    if (!preview) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 书签聚焦时关闭卡片，先把焦点还给对应刻度，避免落到页面开头。
      if (previewRef.current?.contains(document.activeElement)) {
        railRef.current
          ?.querySelector<HTMLElement>(`[data-timeline-item="${CSS.escape(preview.id)}"]`)
          ?.focus({ preventScroll: true })
      }
      closePreview()
      event.stopPropagation()
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [preview, closePreview])

  // 极长对话保留最小命中高度，可用滚轮继续浏览，不裁掉首尾消息。
  const tickHeight = Math.max(6, Math.min(12, RAIL_HEIGHT_BUDGET_PX / items.length))
  const jump = (messageId: string) => {
    onJump(messageId)
    closePreview()
  }

  return (
    <nav
      ref={navRef}
      data-testid="timeline-nav"
      data-position={position}
      aria-label="消息时间轴导航"
      className="hc-timeline"
      onPointerEnter={cancelCollapse}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') scheduleCollapse()
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleCollapse()
      }}
    >
      <div ref={railRef} className="hc-timeline-rail" onScroll={positionPreview}>
        {items.map((item, index) => {
          const distance = preview ? Math.abs(index - previewIndex) : Infinity
          const current =
            activeIndex >= 0 && index >= currentGroupStart && index < currentGroupStart + 3
          return (
            <button
              key={item.id}
              type="button"
              data-timeline-item={item.id}
              data-current={current || undefined}
              data-bookmarked={item.bookmarked || undefined}
              aria-label={`${index + 1}. ${item.prompt}${item.bookmarked ? '，已收藏' : ''}`}
              aria-current={item.id === activeId ? 'location' : undefined}
              aria-expanded={item.id === previewId}
              aria-controls={item.id === previewId ? previewDomId : undefined}
              tabIndex={item.id === (previewId ?? activeId ?? items[0]?.id) ? 0 : -1}
              className="hc-timeline-tick"
              style={{ height: tickHeight }}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') showPreview(item.id)
              }}
              onFocus={() => showPreview(item.id)}
              onClick={() => jump(item.id)}
              onKeyDown={(event) => {
                let nextIndex: number
                if (event.key === 'ArrowDown') nextIndex = Math.min(items.length - 1, index + 1)
                else if (event.key === 'ArrowUp') nextIndex = Math.max(0, index - 1)
                else if (event.key === 'Home') nextIndex = 0
                else if (event.key === 'End') nextIndex = items.length - 1
                else return
                event.preventDefault()
                const nextTick = railRef.current!.children[nextIndex] as HTMLElement
                nextTick.focus({ preventScroll: true })
                nextTick.scrollIntoView({ block: 'nearest' })
              }}
            >
              <svg
                aria-hidden="true"
                fill="currentColor"
                className={clsx(
                  'hc-timeline-bar',
                  item.id === previewId && 'hc-timeline-bar-hovered',
                )}
                style={{ width: [32, 24, 18, 12][distance] ?? 8 }}
              >
                <rect width="100%" height="100%" rx="0.5" />
                {item.bookmarked && <circle className="hc-timeline-bookmark-dot" />}
              </svg>
            </button>
          )
        })}
      </div>
      {preview && (
        <div
          ref={previewRef}
          id={previewDomId}
          data-testid="timeline-preview"
          className="hc-timeline-preview hc-timeline-panel-in"
          onPointerEnter={cancelCollapse}
          onFocusCapture={cancelCollapse}
        >
          <button
            type="button"
            className="hc-timeline-jump"
            aria-label={`跳转到：${preview.prompt}`}
            onClick={() => jump(preview.id)}
          />
          <div className="hc-timeline-preview-heading">
            <div className="hc-timeline-prompt">{preview.prompt}</div>
            <button
              type="button"
              aria-label={preview.bookmarked ? '取消收藏' : '收藏这轮对话'}
              aria-pressed={preview.bookmarked}
              disabled={bookmark.isPending}
              className="hc-timeline-bookmark"
              onClick={() =>
                bookmark.mutate({ messageId: preview.id, bookmarked: !preview.bookmarked })
              }
            >
              <Bookmark
                aria-hidden="true"
                className="h-[18px] w-[18px]"
                fill={preview.bookmarked ? 'currentColor' : 'none'}
                strokeWidth={1.6}
              />
            </button>
          </div>
          <Markdown text={preview.reply} variant="preview" />
        </div>
      )}
    </nav>
  )
}
