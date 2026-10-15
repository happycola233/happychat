import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import type { MessageTimeFormat } from '@shared/types/domain'
import { useLocalDate } from '../hooks/useLocalDate'
import { formatMessageTime, formatMessageTimeDetails } from './messageTime'

export const MessageTimeLabel = memo(function MessageTimeLabel({
  timestamp,
  format,
  className,
}: {
  timestamp: number
  format: MessageTimeFormat
  className?: string
}) {
  const { today, timeZone } = useLocalDate()
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const label = formatMessageTime(timestamp, format, today, timeZone)
  const details = formatMessageTimeDetails(timestamp, timeZone)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current!.getBoundingClientRect()
    const panel = panelRef.current!
    const { width, height } = panel.getBoundingClientRect()
    const left = Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8))
    const top =
      trigger.top >= height + 16
        ? trigger.top - height - 8
        : Math.min(trigger.bottom + 8, window.innerHeight - height - 8)
    panel.style.left = `${left}px`
    panel.style.top = `${Math.max(8, top)}px`
  }, [])

  const cancelHide = () => clearTimeout(hideTimer.current)
  const show = () => {
    cancelHide()
    panelRef.current!.showPopover()
    updatePosition()
  }
  const scheduleHide = () => {
    cancelHide()
    hideTimer.current = setTimeout(() => {
      if (!triggerRef.current!.matches(':focus-visible')) panelRef.current!.hidePopover()
    }, 120)
  }

  useEffect(() => () => clearTimeout(hideTimer.current), [])
  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, timeZone, updatePosition])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={id}
        popoverTargetAction="show"
        aria-label={`${label}，查看完整时间`}
        aria-describedby={id}
        className={clsx(
          '-my-1 shrink-0 whitespace-nowrap rounded px-0.5 py-1 text-xs tabular-nums text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
          className,
        )}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') show()
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') scheduleHide()
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) show()
        }}
        onBlur={scheduleHide}
        onClick={show}
      >
        <time dateTime={new Date(timestamp).toISOString()}>{label}</time>
      </button>
      {/* 原生浮层负责 Esc、外点关闭和顶层绘制，避免被聊天滚动区或分享页裁切。 */}
      <div
        ref={panelRef}
        id={id}
        popover="auto"
        role="tooltip"
        onToggle={(event) => {
          setOpen(event.newState === 'open')
          if (event.newState === 'closed') cancelHide()
        }}
        onPointerEnter={cancelHide}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') scheduleHide()
        }}
        className="fixed inset-auto m-0 max-w-[calc(100vw-1rem)] rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left text-xs leading-5 text-neutral-800 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      >
        <div>{details.date}</div>
        <div className="tabular-nums text-neutral-500 dark:text-neutral-400">{details.time}</div>
      </div>
    </>
  )
})
