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

/**
 * 状态说明兼顾三种操作：鼠标悬停、键盘聚焦会临时显示，点击则固定显示。
 * 浮层通过 portal 逃逸表格的横向滚动裁剪；其中没有可聚焦控件，焦点始终留在触发按钮。
 */
export function RequestOutcomeBadge(props: RequestOutcomeBadgeProps) {
  const presentation = requestOutcomePresentation(props)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipId = useId()
  const [anchor, setAnchor] = useState<AnchorPosition | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const open = !dismissed && (hovered || focused || pinned)

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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPinned(false)
      setHovered(false)
      // Escape 只关闭说明，焦点留在触发标签，键盘用户不会丢失表格中的当前位置。
      setDismissed(true)
    }
    window.addEventListener('resize', updateAnchor)
    window.addEventListener('scroll', updateAnchor, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('resize', updateAnchor)
      window.removeEventListener('scroll', updateAnchor, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, updateAnchor])

  useEffect(() => {
    if (!pinned) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !tooltipRef.current?.contains(target)) {
        setPinned(false)
        setDismissed(true)
      }
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [pinned])

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
        aria-controls={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => {
          cancelScheduledHide()
          updateAnchor()
          setDismissed(false)
          setHovered(true)
        }}
        onMouseLeave={scheduleHoverHide}
        onFocus={() => {
          updateAnchor()
          setDismissed(false)
          setFocused(true)
        }}
        onBlur={() => {
          setFocused(false)
          // 键盘移到下一行时同时解除固定，避免上一行的说明浮层残留。
          setPinned(false)
          setDismissed(false)
        }}
        onClick={() => {
          updateAnchor()
          if (pinned) {
            setPinned(false)
            setHovered(false)
            setDismissed(true)
          } else {
            setDismissed(false)
            setPinned(true)
          }
        }}
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
            <p className="mt-2 border-t border-neutral-100 pt-2 text-[11px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
              {pinned ? '说明已固定；再次点击状态标签或按 Esc 关闭。' : '点击状态标签可固定说明。'}
            </p>
          </div>,
          document.body,
        )}
    </>
  )
}
