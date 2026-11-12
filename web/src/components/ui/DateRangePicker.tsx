import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { CalendarRange, Check, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { draftDateRange, formatDateRange, RANGE_PRESETS, type DateRange } from '../../lib/dateRange'
import { parseLocalDateTimeInput, toLocalDateTimeInput } from '../../lib/localDateTime'
import { Button } from './Button'
import { inputClass } from './controlStyles'
import { placeSelectMenu, type SelectMenuCoords } from './selectMenuPosition'

const PANEL_MAX_HEIGHT = 520
const PANEL_MAX_WIDTH = 320

/** 统计时间范围：常用范围一键切换，也可指定精确到分钟的起止时间。 */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange
  onChange: (range: DateRange) => void
}) {
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<SelectMenuCoords | null>(null)
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd] = useState('')

  const start = parseLocalDateTimeInput(draftStart)
  const end = parseLocalDateTimeInput(draftEnd)
  const draftRange: DateRange | null =
    start != null && end != null && start < end ? { key: 'custom', start, end } : null
  const draftInverted = start != null && end != null && !draftRange

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }

  const openPanel = () => {
    const draft = draftDateRange(value)
    setDraftStart(toLocalDateTimeInput(draft.start))
    setDraftEnd(toLocalDateTimeInput(draft.end))
    setOpen(true)
  }

  const commit = (range: DateRange) => {
    onChange(range)
    close()
  }

  const applyCustom = (event: FormEvent) => {
    event.preventDefault()
    if (draftRange) commit(draftRange)
  }

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    const update = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      setCoords(
        placeSelectMenu({
          trigger: { top: rect.top, left: rect.left, bottom: rect.bottom, width: rect.width },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          contentHeight: panelRef.current?.scrollHeight ?? PANEL_MAX_HEIGHT,
          menuWidth: PANEL_MAX_WIDTH,
          maxHeight: PANEL_MAX_HEIGHT,
          maxWidth: PANEL_MAX_WIDTH,
        }),
      )
    }
    update()
    window.addEventListener('resize', update)
    // 祖先滚动会带动触发器，捕获阶段才能收到 overflow 容器里的 scroll。
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // 定位完成后再把焦点移入面板（当前选项或自定义开始时间），避免首帧不可见时聚焦导致页面滚动。
  useEffect(() => {
    const panel = panelRef.current
    if (!coords || !panel || panel.contains(document.activeElement)) return
    const target =
      panel.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      panel.querySelector<HTMLElement>('input')
    target?.focus({ preventScroll: true })
  }, [coords])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close(false)
    }
    // 捕获 Escape，避免外层弹窗（window keydown）一起关闭。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const panel =
    open &&
    createPortal(
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-label="统计时间范围"
        style={
          coords
            ? {
                left: coords.left,
                width: coords.width,
                maxHeight: coords.maxHeight,
                top: coords.top,
                bottom: coords.bottom,
              }
            : { visibility: 'hidden', left: 0, top: 0, width: PANEL_MAX_WIDTH }
        }
        // 焦点经 Tab 移到面板外的页面元素时收起；切到原生日期选择窗口时 relatedTarget 为空，不收起。
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null
          if (next && !panelRef.current?.contains(next) && !triggerRef.current?.contains(next))
            close(false)
        }}
        className="hc-pop-in hc-scrollbar fixed z-[80] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-2 text-neutral-800 shadow-[0_12px_40px_rgb(0_0_0/0.14)] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
      >
        <div className="grid grid-cols-2 gap-1">
          {RANGE_PRESETS.map((preset) => {
            const active = value.key === preset.key
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={active}
                onClick={() => commit({ key: preset.key })}
                className={clsx(
                  'flex min-h-8 items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/50',
                  active
                    ? 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-100'
                    : 'hover:bg-neutral-100 dark:hover:bg-white/10',
                )}
              >
                {preset.label}
                {active && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-sky-500 dark:text-sky-400" />
                )}
              </button>
            )
          })}
        </div>
        <form
          onSubmit={applyCustom}
          className="mt-2 space-y-2.5 border-t border-neutral-100 px-1 pb-1 pt-3 dark:border-neutral-800"
        >
          <div className="flex items-center justify-between text-xs font-medium text-neutral-600 dark:text-neutral-400">
            自定义时间段
            {value.key === 'custom' && (
              <Check className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" aria-label="当前使用" />
            )}
          </div>
          {(
            [
              ['开始', draftStart, setDraftStart],
              ['结束', draftEnd, setDraftEnd],
            ] as const
          ).map(([label, draft, setDraft]) => (
            <label key={label} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
              <input
                type="datetime-local"
                required
                className={clsx(inputClass, 'tabular-nums')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
          ))}
          {draftInverted && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
              结束时间需晚于开始时间
            </p>
          )}
          <div className="flex justify-end gap-2 pt-0.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => close()}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={!draftRange}>
              应用
            </Button>
          </div>
        </form>
      </div>,
      document.body,
    )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`统计时间范围：${formatDateRange(value)}`}
        onClick={() => (open ? close() : openPanel())}
        className={clsx(
          'inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg border bg-white px-3 text-[13px] leading-4 text-neutral-800 outline-none transition select-none',
          'border-neutral-200 hover:border-neutral-400 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/15',
          'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20',
          open && 'border-sky-500 ring-2 ring-sky-500/15 dark:border-sky-400 dark:ring-sky-400/20',
        )}
      >
        <CalendarRange
          aria-hidden
          className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500"
        />
        <span className="min-w-0 truncate tabular-nums">{formatDateRange(value)}</span>
        <ChevronDown
          aria-hidden
          className={clsx(
            'h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform dark:text-neutral-500',
            open && 'rotate-180 text-sky-500 dark:text-sky-400',
          )}
        />
      </button>
      {panel}
    </>
  )
}
