import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { clsx } from 'clsx'
import { resolveActiveTimelineId, type TimelineItem } from './timelineItems'

/** 鼠标短暂划出（去点列表项/回到正文）时不立刻收起，避免闪烁。 */
const COLLAPSE_DELAY_MS = 160
/** 收起态小横条的总高度预算：条数很多时压缩间距而不是无限变高。 */
const RAIL_HEIGHT_BUDGET_PX = 320
const BAR_HEIGHT_PX = 2

interface Props {
  /** 当前可见路径上的用户消息（时间顺序）。 */
  items: TimelineItem[]
  /** 聊天滚动容器（消息锚点 [data-scroll-anchor] 的宿主）。 */
  scrollContainerRef: RefObject<HTMLDivElement | null>
  /** 点击条目时跳转到对应消息。 */
  onJump: (messageId: string) => void
}

/**
 * 消息时间轴导航（仅桌面端渲染）：
 * 收起态是右缘一列小横条，随页面滚动高亮当前所处的用户消息；
 * 悬停/聚焦展开为可滚动的消息预览列表，点击平滑跳转。
 */
export function TimelineNav({ items, scrollContainerRef, onJump }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const collapseTimerRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const panelScrollRef = useRef<HTMLDivElement>(null)

  const syncActive = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    // 每次滚动实时量取锚点位置：流式输出会持续改变内容高度，缓存会失真。
    const containerTop = container.getBoundingClientRect().top
    const tops = new Map<string, number>()
    for (const el of container.querySelectorAll<HTMLElement>('[data-scroll-anchor]')) {
      const id = el.dataset.scrollAnchor
      if (id) tops.set(id, el.getBoundingClientRect().top - containerTop + container.scrollTop)
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
      ),
    )
  }, [items, scrollContainerRef])

  useEffect(() => {
    syncActive()
    const container = scrollContainerRef.current
    if (!container) return
    const onScroll = () => {
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        syncActive()
      })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      container.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [syncActive, scrollContainerRef])

  // 展开瞬间把高亮行滚进面板可视区，长对话不用手动找。
  useEffect(() => {
    if (!expanded || !activeId) return
    panelScrollRef.current
      ?.querySelector(`[data-timeline-item="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [expanded, activeId])

  useEffect(
    () => () => {
      if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current)
    },
    [],
  )

  const openPanel = () => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
    setExpanded(true)
  }

  const scheduleCollapse = () => {
    if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null
      setExpanded(false)
    }, COLLAPSE_DELAY_MS)
  }

  // 条数多时按预算压缩间距，保持整列不超过约一屏的三分之一。
  const barGap =
    items.length > 1
      ? Math.max(
          3,
          Math.min(
            7,
            Math.floor((RAIL_HEIGHT_BUDGET_PX - items.length * BAR_HEIGHT_PX) / (items.length - 1)),
          ),
        )
      : 0

  return (
    <div
      data-testid="timeline-nav"
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') openPanel()
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') scheduleCollapse()
      }}
      onFocusCapture={openPanel}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) scheduleCollapse()
      }}
    >
      {/* 收起态：一列小横条，右对齐；当前位置的一条更长更深。 */}
      <button
        type="button"
        aria-label="消息时间轴导航"
        aria-expanded={expanded}
        onClick={openPanel}
        className={clsx(
          'flex max-h-[360px] flex-col items-end justify-center overflow-hidden px-2 py-2 outline-none transition-opacity duration-150',
          expanded && 'pointer-events-none opacity-0',
        )}
        style={{ gap: barGap }}
      >
        {items.map((item) => (
          <span
            key={item.id}
            className={clsx(
              'block rounded-full transition-all duration-200',
              item.id === activeId
                ? 'w-4 bg-neutral-700 dark:bg-neutral-200'
                : 'w-3 bg-neutral-300 dark:bg-neutral-700',
            )}
            style={{ height: BAR_HEIGHT_PX }}
          />
        ))}
      </button>

      {/* 展开态：右侧浮出的消息预览列表。定位层与动画层分离，避免 translate 被动画覆盖。 */}
      {expanded && (
        <div className="absolute right-0 top-1/2 z-30 -translate-y-1/2">
          <div className="hc-timeline-panel-in w-64 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-[0_12px_40px_rgb(0_0_0/0.14)] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-[0_12px_40px_rgb(0_0_0/0.45)]">
            <div ref={panelScrollRef} className="hc-scrollbar max-h-[min(60vh,26rem)] overflow-y-auto">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-timeline-item={item.id}
                  onClick={() => onJump(item.id)}
                  title={item.label}
                  className={clsx(
                    'block w-full truncate rounded-lg px-3 py-1.5 text-left text-[13px] leading-5 transition',
                    item.id === activeId
                      ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
