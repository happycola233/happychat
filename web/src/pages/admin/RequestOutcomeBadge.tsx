import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import type { UsageLogDTO } from '@shared/types/api'
import { Badge } from '../../components/ui/Badge'
import { requestOutcomePresentation } from './requestOutcome'

interface AnchorPosition {
  left: number
  top: number
  placement: 'above' | 'below'
  width: number
  maxHeight: number
}

type RequestOutcomeBadgeProps = Pick<UsageLogDTO, 'kind' | 'result' | 'terminalReason'>

/** 状态说明仅在鼠标悬停或键盘聚焦时显示，并通过 portal 逃逸表格滚动裁剪。 */
export function RequestOutcomeBadge(props: RequestOutcomeBadgeProps) {
  const presentation = requestOutcomePresentation(props)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipId = useId()
  const [anchor, setAnchor] = useState<AnchorPosition | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const open = hovered || focused

  const updateAnchor = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(352, window.innerWidth - 24)
    const halfWidth = width / 2
    const spaceAbove = rect.top - 12
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const placement = spaceBelow >= 260 || spaceBelow >= spaceAbove ? 'below' : 'above'
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, 12 + halfWidth),
      window.innerWidth - 12 - halfWidth,
    )
    setAnchor({
      left,
      top: placement === 'above' ? rect.top - 8 : rect.bottom + 8,
      placement,
      width,
      maxHeight: Math.max(80, placement === 'above' ? spaceAbove : spaceBelow),
    })
  }, [])

  const cancelScheduledHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }

  const scheduleHoverHide = () => {
    cancelScheduledHide()
    hideTimerRef.current = setTimeout(() => setHovered(false), 100)
  }

  useEffect(() => {
    if (!open) return
    updateAnchor()
    window.addEventListener('resize', updateAnchor)
    window.addEventListener('scroll', updateAnchor, true)
    return () => {
      window.removeEventListener('resize', updateAnchor)
      window.removeEventListener('scroll', updateAnchor, true)
    }
  }, [open, updateAnchor])

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    },
    [],
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${presentation.label}，查看请求结果说明`}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => {
          cancelScheduledHide()
          updateAnchor()
          setHovered(true)
        }}
        onMouseLeave={scheduleHoverHide}
        onFocus={() => {
          updateAnchor()
          setFocused(true)
        }}
        onBlur={() => setFocused(false)}
        // 阻止鼠标按下把焦点留在标签上，避免点击后说明因 focus 状态持续显示。
        onPointerDown={(event) => event.preventDefault()}
        className="cursor-help rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-sky-400/50 dark:focus-visible:ring-offset-neutral-900"
      >
        <Badge tone={presentation.tone}>
          {presentation.label}
          <Info aria-hidden="true" className="ml-1 h-3 w-3 opacity-65" />
        </Badge>
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            id={tooltipId}
            ref={tooltipRef}
            role="tooltip"
            onMouseEnter={() => {
              cancelScheduledHide()
              setHovered(true)
            }}
            onMouseLeave={scheduleHoverHide}
            style={{
              left: anchor.left,
              top: anchor.top,
              width: anchor.width,
              maxHeight: anchor.maxHeight,
            }}
            className={`hc-pop-in fixed z-[70] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-xl dark:border-neutral-700 dark:bg-neutral-900 ${
              anchor.placement === 'above' ? '-translate-y-full' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <Badge tone={presentation.tone}>{presentation.label}</Badge>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                请求业务结果
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-700 dark:text-neutral-200">
              {presentation.summary}
            </p>
            <dl className="mt-2 space-y-2 border-t border-neutral-100 pt-2 text-xs leading-5 dark:border-neutral-800">
              {props.terminalReason && (
                <div className="grid grid-cols-[4.25rem_1fr] gap-2">
                  <dt className="text-neutral-400 dark:text-neutral-500">终止原因</dt>
                  <dd className="min-w-0 text-neutral-600 dark:text-neutral-300">
                    {presentation.reasonLabel}
                    <code className="ml-1 break-all rounded bg-neutral-100 px-1 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                      {props.terminalReason}
                    </code>
                  </dd>
                </div>
              )}
              <div className="grid grid-cols-[4.25rem_1fr] gap-2">
                <dt className="text-neutral-400 dark:text-neutral-500">内容处理</dt>
                <dd className="text-neutral-600 dark:text-neutral-300">
                  {presentation.contentNote}
                </dd>
              </div>
              <div className="grid grid-cols-[4.25rem_1fr] gap-2">
                <dt className="text-neutral-400 dark:text-neutral-500">用量口径</dt>
                <dd className="text-neutral-600 dark:text-neutral-300">{presentation.usageNote}</dd>
              </div>
              {presentation.nextStep && (
                <div className="grid grid-cols-[4.25rem_1fr] gap-2">
                  <dt className="text-neutral-400 dark:text-neutral-500">建议</dt>
                  <dd className="text-neutral-600 dark:text-neutral-300">
                    {presentation.nextStep}
                  </dd>
                </div>
              )}
            </dl>
          </div>,
          document.body,
        )}
    </>
  )
}
