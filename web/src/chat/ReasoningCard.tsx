import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown } from 'lucide-react'
import { Markdown } from './Markdown'
import { elapsedSeconds } from './elapsed'
import { normalizeReasoningMarkdown } from './reasoningMarkdown'
import { splitReasoningSections, type ReasoningSection } from './reasoningSections'

export type ReasoningCardStatus = 'thinking' | 'completed' | 'stopped'

interface CollapseScrollAnchor {
  scroller: HTMLElement
  cardTop: number
}

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (/(auto|scroll|overlay)/.test(overflowY) && parent.scrollHeight > parent.clientHeight) {
      return parent
    }
    parent = parent.parentElement
  }

  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
}

function clampScrollTop(scroller: HTMLElement, top: number) {
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  return Math.min(Math.max(0, top), maxScrollTop)
}

function scrollViewportTop(scroller: HTMLElement): number {
  return scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top
}

function stickyTopOffset(sticky: HTMLElement): number {
  const top = Number.parseFloat(window.getComputedStyle(sticky).top)
  return Number.isFinite(top) ? top : 0
}

interface Props {
  text: string
  status: ReasoningCardStatus
  /** 上游开始响应的时间，用于刷新续传后保持计时 */
  startedAt: number | null
  /** 完成后的思考耗时；刷新后的持久化消息由服务端计算。 */
  durationMs?: number | null
  /** 默认是否展开推理（来自用户设置）；关闭时不随思考自动展开。 */
  defaultExpanded?: boolean
  /** sticky 状态行的 top 类；分享页会把它钉在公开页头部下方。 */
  stickyTopClassName?: string
}

function CompletedIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
      data-testid="reasoning-completed-icon"
      className="h-[14px] w-[14px] shrink-0"
    >
      <path d="M12.498 6.909a.665.665 0 0 1 1.088.766L9.627 13.3a.665.665 0 0 1-.982.117l-.054-.053-2.083-2.292-.08-.107a.666.666 0 0 1 .964-.877l.1.09 1.525 1.676z" />
      <path
        fillRule="evenodd"
        d="M10.333 2.085a7.915 7.915 0 1 1 0 15.83 7.915 7.915 0 0 1 0-15.83m0 1.33a6.585 6.585 0 1 0 0 13.17 6.585 6.585 0 0 0 0-13.17"
        clipRule="evenodd"
      />
    </svg>
  )
}

function ReasoningSections({ sections }: { sections: ReasoningSection[] }) {
  return (
    <div className="space-y-2.5">
      {sections.map((section, index) => {
        const hasBody = section.body.trim().length > 0
        return (
          <section
            className="hc-reasoning-section grid grid-cols-[14px_minmax(0,1fr)] gap-x-2"
            key={`${section.title ?? 'section'}-${index}`}
          >
            {section.title && (
              <>
                <span
                  aria-hidden
                  className="mt-[0.55rem] h-1.5 w-1.5 justify-self-center rounded-full bg-neutral-500 dark:bg-neutral-400"
                />
                <div className="text-sm leading-6 font-medium text-neutral-950 dark:text-neutral-100">
                  {section.title}
                </div>
              </>
            )}
            {(hasBody || !section.title) && (
              <>
                <span
                  aria-hidden
                  className={clsx(
                    'w-px justify-self-center bg-neutral-300 dark:bg-neutral-600',
                    section.title && 'mt-1',
                  )}
                />
                <div className={clsx('min-w-0', section.title && 'mt-1')}>
                  {hasBody && (
                    <Markdown
                      text={section.body}
                      variant="reasoning"
                      className="hc-reasoning-detail"
                    />
                  )}
                </div>
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}

interface TopStatusLineProps {
  status: ReasoningCardStatus
  label: string
  hasSummary: boolean
  open: boolean
  onToggle: () => void
}

function TopStatusLine({ status, label, hasSummary, open, onToggle }: TopStatusLineProps) {
  const className = clsx(
    'hc-reasoning-status inline-flex items-center gap-2 text-[15px] leading-7 transition-colors',
  )

  const content = (
    <>
      <span
        className={clsx(status === 'thinking' && 'hc-reasoning-shimmer')}
        data-testid="reasoning-top-label"
      >
        {label}
      </span>
      {hasSummary && (
        <ChevronDown
          className={clsx('h-3.5 w-3.5 transition-transform duration-300', open && 'rotate-180')}
        />
      )}
    </>
  )

  if (!hasSummary) {
    return (
      <div className={className} data-testid="reasoning-top-status">
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? '折叠推理摘要' : '展开推理摘要'}
      className={className}
      data-testid="reasoning-top-toggle"
    >
      {content}
    </button>
  )
}

interface SummaryFooterProps {
  label: string
}

function SummaryFooter({ label }: SummaryFooterProps) {
  return (
    <div
      className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-2 text-left transition-colors"
      data-testid="reasoning-summary-footer"
    >
      <span
        className="mt-[5px] justify-self-center text-neutral-950 dark:text-neutral-100"
        aria-hidden
      >
        <CompletedIcon />
      </span>
      <div className="min-w-0">
        <div className="hc-reasoning-footer-title text-sm leading-6 font-medium text-neutral-950 dark:text-neutral-100">
          {label}
        </div>
        <div className="hc-reasoning-footer-detail text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
          完成
        </div>
      </div>
    </div>
  )
}

export function ReasoningCard({
  text,
  status,
  startedAt,
  durationMs,
  defaultExpanded = false,
  stickyTopClassName = 'top-0',
}: Props) {
  const [seconds, setSeconds] = useState(0)
  const [open, setOpen] = useState(defaultExpanded)
  const cardRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)
  const hadTextRef = useRef(false)
  const collapseAnchorRef = useRef<CollapseScrollAnchor | null>(null)
  const normalizedText = useMemo(() => normalizeReasoningMarkdown(text), [text])
  const sections = useMemo(() => splitReasoningSections(normalizedText), [normalizedText])
  const hasText = sections.length > 0

  useEffect(() => {
    if (status === 'thinking') {
      setSeconds(elapsedSeconds(startedAt))
      const t = setInterval(() => {
        setSeconds(elapsedSeconds(startedAt))
      }, 200)
      return () => clearInterval(t)
    }
    return undefined
  }, [status, startedAt])

  useEffect(() => {
    // 仅在「默认展开」开启时随推理文本出现自动展开；关闭时保持折叠由用户手动展开。
    if (!defaultExpanded) return
    if (hasText && !hadTextRef.current) {
      setOpen(true)
      hadTextRef.current = true
    } else if (!hasText) {
      hadTextRef.current = false
    }
  }, [hasText, defaultExpanded])

  const captureCollapseAnchor = useCallback(() => {
    const card = cardRef.current
    const sticky = stickyRef.current
    if (!card || !sticky) return

    const scroller = findScrollContainer(card)
    if (!scroller) return

    const scrollerTop = scrollViewportTop(scroller)
    const stickyTop = stickyTopOffset(sticky)
    const stickyEdge = scrollerTop + stickyTop
    const stickyRect = sticky.getBoundingClientRect()
    const stickyPinned = stickyRect.top <= stickyEdge + 1 && stickyRect.bottom > stickyEdge
    if (!stickyPinned) return

    const cardRect = card.getBoundingClientRect()
    collapseAnchorRef.current = {
      scroller,
      // 折叠时按 sticky 偏移重新锚定整张思考卡，让状态行留在原位。
      cardTop: scroller.scrollTop + cardRect.top - scrollerTop - stickyTop,
    }
  }, [])

  useLayoutEffect(() => {
    if (open) return undefined
    const anchor = collapseAnchorRef.current
    if (!anchor) return undefined
    collapseAnchorRef.current = null

    const restore = () => {
      anchor.scroller.scrollTop = clampScrollTop(anchor.scroller, anchor.cardTop)
    }
    restore()
    const frame = window.requestAnimationFrame(restore)
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const toggleOpen = useCallback(() => {
    if (open) captureCollapseAnchor()
    setOpen((o) => !o)
  }, [captureCollapseAnchor, open])

  const completedSeconds =
    durationMs !== undefined && durationMs !== null
      ? Math.max(0, Math.floor(durationMs / 1000))
      : seconds
  const label =
    status === 'stopped'
      ? '已停止思考'
      : status === 'completed'
        ? `已思考 ${completedSeconds}s`
        : `正在思考 ${seconds}s`

  return (
    <div ref={cardRef} className="hc-reasoning space-y-1" data-testid="reasoning-card">
      <div
        ref={stickyRef}
        className={clsx(
          'hc-reasoning-sticky relative sticky',
          stickyTopClassName,
          'z-20 -mx-2 px-2 py-1',
        )}
      >
        <TopStatusLine
          status={status}
          label={label}
          hasSummary={hasText}
          open={open}
          onToggle={toggleOpen}
        />
      </div>
      {hasText && (
        <div
          className={clsx(
            'hc-reasoning-collapse grid transition-[grid-template-rows,opacity] duration-300 ease-out',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
          aria-hidden={!open}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="pt-1 pr-2 pb-1">
              <ReasoningSections sections={sections} />
              {status === 'completed' && (
                <div className="mt-3">
                  <SummaryFooter label={label} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
