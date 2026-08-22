import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import {
  findSelectTypeaheadMatch,
  readSelectTypeaheadKey,
  resolveSelectOpeningHighlight,
} from './selectKeyboard'
import { placeSelectMenu, type SelectMenuCoords } from './selectMenuPosition'

export interface SelectOption {
  value: string
  label: string
}

/** 与原生 change 事件同形，现有 `e.target.value` 调用点不用改。 */
export interface SelectChangeEvent {
  target: { value: string }
}

interface Props {
  label?: string
  options: readonly SelectOption[]
  value?: string
  onChange?: (event: SelectChangeEvent) => void
  disabled?: boolean
  className?: string
  id?: string
  name?: string
  'aria-label'?: string
  /** sm=筛选条紧凑款；md=与表单输入框同高。 */
  size?: 'sm' | 'md'
}

const TYPEAHEAD_RESET_MS = 500

function emitChange(onChange: Props['onChange'], value: string) {
  onChange?.({ target: { value } })
}

export function Select({
  label,
  options,
  value = '',
  onChange,
  disabled = false,
  className,
  id,
  name,
  'aria-label': ariaLabel,
  size = 'sm',
}: Props) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef({ query: '', timer: 0 })
  const openingHighlightRef = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [coords, setCoords] = useState<SelectMenuCoords | null>(null)

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const displayLabel = selected?.label ?? (value || '请选择')

  const close = () => {
    openingHighlightRef.current = undefined
    setOpen(false)
  }

  const openMenu = (preferredIndex?: number) => {
    openingHighlightRef.current = preferredIndex
    setOpen(true)
  }

  const commit = (next: string) => {
    if (next !== value) emitChange(onChange, next)
    close()
    triggerRef.current?.focus({ preventScroll: true })
  }

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    setHighlightedIndex(
      resolveSelectOpeningHighlight(options.length, selectedIndex, openingHighlightRef.current),
    )
    openingHighlightRef.current = undefined

    const update = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const menu = menuRef.current
      const contentHeight = menu?.scrollHeight ?? options.length * 36 + 8
      setCoords(
        placeSelectMenu({
          trigger: {
            top: rect.top,
            left: rect.left,
            bottom: rect.bottom,
            width: rect.width,
          },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          contentHeight,
          menuWidth: menu ? Math.max(menu.offsetWidth, menu.scrollWidth) : undefined,
        }),
      )
    }

    update()
    const raf = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    // 祖先滚动会带动触发器，捕获阶段才能收到 overflow 容器里的 scroll。
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, options.length, selectedIndex])

  useLayoutEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelector<HTMLElement>('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, highlightedIndex])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    // 捕获 Escape，避免管理弹窗（window keydown）把整个 Modal 一起关掉。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
      triggerRef.current?.focus({ preventScroll: true })
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  useEffect(() => {
    const typeahead = typeaheadRef.current
    return () => window.clearTimeout(typeahead.timer)
  }, [])

  const moveHighlight = (delta: number) => {
    if (options.length === 0) return
    setHighlightedIndex((current) => (current + delta + options.length) % options.length)
  }

  const applyTypeahead = (key: string) => {
    const nextQuery = `${typeaheadRef.current.query}${key}`.toLocaleLowerCase()
    typeaheadRef.current.query = nextQuery
    window.clearTimeout(typeaheadRef.current.timer)
    typeaheadRef.current.timer = window.setTimeout(() => {
      typeaheadRef.current.query = ''
    }, TYPEAHEAD_RESET_MS)
    return findSelectTypeaheadMatch(options, nextQuery)
  }

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'Tab') {
      if (open) close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setHighlightedIndex(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setHighlightedIndex(Math.max(0, options.length - 1))
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault()
      const option = options[highlightedIndex]
      if (option) commit(option.value)
      return
    }
    if (event.key === ' ' && !open) {
      event.preventDefault()
      openMenu()
      return
    }
    const typeaheadKey = readSelectTypeaheadKey(event)
    if (typeaheadKey) {
      const match = applyTypeahead(typeaheadKey)
      if (!open) {
        openMenu(match)
        return
      }
      if (match >= 0) setHighlightedIndex(match)
    }
  }

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      id={id}
      disabled={disabled}
      role="combobox"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-activedescendant={open ? `${listboxId}-opt-${highlightedIndex}` : undefined}
      onClick={() => {
        if (disabled) return
        if (open) close()
        else openMenu()
      }}
      onKeyDown={onTriggerKeyDown}
      className={clsx(
        'inline-flex w-full items-center justify-between gap-2 border text-left text-sm outline-none transition select-none',
        'border-neutral-300 bg-white text-neutral-800',
        'hover:border-neutral-400',
        'focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/15',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:border-neutral-500',
        'dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20',
        size === 'md' ? 'min-h-10 rounded-xl px-3.5' : 'min-h-9 rounded-lg px-3',
        open && 'border-sky-500 ring-2 ring-sky-500/15 dark:border-sky-400 dark:ring-sky-400/20',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
      <ChevronDown
        aria-hidden="true"
        className={clsx(
          'h-4 w-4 shrink-0 text-neutral-400 transition-transform dark:text-neutral-500',
          open && 'rotate-180 text-sky-500 dark:text-sky-400',
        )}
      />
    </button>
  )

  const menu =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={menuRef}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel ?? label}
        style={
          coords
            ? {
                left: coords.left,
                minWidth: coords.width,
                maxHeight: coords.maxHeight,
                top: coords.top,
                bottom: coords.bottom,
              }
            : {
                visibility: 'hidden',
                left: 0,
                top: 0,
                minWidth: triggerRef.current?.offsetWidth,
              }
        }
        className="hc-pop-in hc-scrollbar fixed z-[80] w-max max-w-[min(22.5rem,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-1 shadow-[0_12px_40px_rgb(0_0_0/0.14)] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
      >
        {options.map((option, index) => {
          const active = option.value === value
          const highlighted = index === highlightedIndex
          return (
            <div
              key={`${option.value}-${index}`}
              id={`${listboxId}-opt-${index}`}
              role="option"
              aria-selected={active}
              data-highlighted={highlighted || undefined}
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(option.value)}
              className={clsx(
                'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition',
                highlighted && !active && 'bg-neutral-100 dark:bg-white/10',
                active && 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-100',
              )}
            >
              <span className="whitespace-nowrap">{option.label}</span>
              <span className="inline-flex w-4 shrink-0 justify-center">
                {active && <Check className="h-4 w-4 text-sky-500 dark:text-sky-400" />}
              </span>
            </div>
          )
        })}
      </div>,
      document.body,
    )

  const hasExplicitWidth = Boolean(className && /\b(?:w-|min-w-|max-w-|flex-1)/.test(className))
  const control = (
    <div
      ref={rootRef}
      className={clsx('inline-grid', hasExplicitWidth ? 'max-w-full' : 'max-w-56', className)}
    >
      {name && <input type="hidden" name={name} value={value} />}
      {/* 按最长选项撑开，避免选中短文案后触发器收缩导致筛选条跳动。 */}
      {options.map((option, index) => (
        <span
          key={`sizer-${option.value}-${index}`}
          aria-hidden
          className={clsx(
            'invisible col-start-1 row-start-1 whitespace-nowrap text-sm',
            size === 'md' ? 'px-3.5 pr-10' : 'px-3 pr-9',
          )}
        >
          {option.label}
        </span>
      ))}
      <div className="col-start-1 row-start-1 min-w-0">{trigger}</div>
      {menu}
    </div>
  )

  if (!label) return control

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      {control}
    </label>
  )
}
