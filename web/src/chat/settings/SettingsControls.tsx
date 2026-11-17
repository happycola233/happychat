import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import type { UserPreferences } from '@shared/types/domain'
import { Toggle } from '../../components/ui/Toggle'
import { useSettings } from '../../store/settings'

/** 仅取布尔类型的偏好键，供开关行复用。 */
type BooleanPrefKey = {
  [K in keyof UserPreferences]: UserPreferences[K] extends boolean ? K : never
}[keyof UserPreferences]

/**
 * 设置分组里的一行。
 * inline：说明在左、控件在右，空间不足时控件自动换到说明下方；
 * stacked：控件需要整行宽度（主题卡片、滑块等），固定排在说明下方。
 */
export function SettingsRow({
  title,
  description,
  control,
  aside,
  layout = 'inline',
}: {
  title: string
  description?: ReactNode
  control: ReactNode
  /** stacked 布局下标题行右侧的轻量操作。 */
  aside?: ReactNode
  layout?: 'inline' | 'stacked'
}) {
  const text = (
    <div className="min-w-0">
      <div className="text-[14px] leading-5 text-neutral-900 dark:text-neutral-100">{title}</div>
      {description && (
        <div className="mt-0.5 text-[12.5px] leading-[1.125rem] text-neutral-500 dark:text-neutral-400">
          {description}
        </div>
      )}
    </div>
  )

  if (layout === 'stacked') {
    return (
      <div className="py-4">
        <div className="flex items-start justify-between gap-4">
          {text}
          {aside}
        </div>
        <div className="mt-3">{control}</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-8 gap-y-2.5 py-3.5">
      <div className="min-w-0 flex-1 basis-40">{text}</div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export function PrefToggleRow({
  prefKey,
  title,
  description,
}: {
  prefKey: BooleanPrefKey
  title: string
  description?: ReactNode
}) {
  const checked = useSettings((s) => s.preferences[prefKey])
  const setPreference = useSettings((s) => s.setPreference)
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <Toggle checked={checked} onChange={(v) => setPreference(prefKey, v)} ariaLabel={title} />
      }
    />
  )
}

type SelectOption<T extends string> = {
  value: T
  label: string
  description?: string
}

/** 设置行内的下拉选择：选项需要额外说明或色点时使用，三项以内的简单枚举改用分段控件。 */
export function PreferenceSelect<
  T extends string,
  TOption extends SelectOption<T> = SelectOption<T>,
>({
  value,
  options,
  onChange,
  menuClassName = 'w-56',
  menuPlacement = 'bottom',
  leading,
  ariaLabel,
}: {
  value: T
  options: readonly TOption[]
  onChange: (v: T) => void
  menuClassName?: string
  /** 菜单在滚动区内用绝对定位，靠近底部的行需改为向上展开以免被裁切。 */
  menuPlacement?: 'top' | 'bottom'
  leading?: (option: TOption) => ReactNode
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!selected) return null

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(event) => {
        if (!open) return
        if (event.key === 'Escape') {
          event.stopPropagation()
          setOpen(false)
          ref.current?.querySelector('button')?.focus()
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const items = Array.from(
            ref.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
          )
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          let next: number
          if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = items.length - 1
          else if (index < 0) next = event.key === 'ArrowUp' ? items.length - 1 : 0
          else next = (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
          items[next]?.focus()
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          // 无边框的轻量触发器：靠文字 + 箭头表达可选，悬停才浮出浅底。
          '-mr-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-neutral-600 transition hover:bg-black/[0.04] hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:text-neutral-300 dark:hover:bg-white/[0.06] dark:hover:text-neutral-100 dark:focus-visible:ring-neutral-600',
          open && 'bg-black/[0.04] text-neutral-900 dark:bg-white/[0.06] dark:text-neutral-100',
        )}
      >
        {leading?.(selected)}
        <span>{selected.label}</span>
        <ChevronDown
          className={clsx(
            'h-4 w-4 text-neutral-400 transition-transform dark:text-neutral-500',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div
          role="menu"
          className={clsx(
            'hc-pop-in absolute right-0 z-40 min-w-full rounded-2xl border border-black/10 bg-white p-1.5 text-neutral-900 shadow-[0_18px_45px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#303030] dark:text-neutral-100 dark:shadow-[0_18px_45px_rgba(0,0,0,0.45)]',
            menuPlacement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
            menuClassName,
          )}
        >
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                  ref.current?.querySelector('button')?.focus()
                }}
                className={clsx(
                  'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition hover:bg-neutral-100 dark:hover:bg-white/10',
                  active && 'bg-neutral-100 dark:bg-white/10',
                )}
              >
                {leading?.(option)}
                <span className="min-w-0 flex-1">
                  <span className="block">{option.label}</span>
                  {option.description && (
                    <span className="mt-1 block text-xs font-normal leading-5 text-neutral-500 dark:text-neutral-400">
                      {option.description}
                    </span>
                  )}
                </span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
