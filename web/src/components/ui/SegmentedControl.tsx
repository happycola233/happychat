import type { ComponentType } from 'react'
import { clsx } from 'clsx'

/** sky：管理端筛选等工具栏的强调态；neutral：设置项等低干扰场景，选中项以白色浮起表示。 */
type SegmentedTone = 'sky' | 'neutral'

const TRACK_CLASS: Record<SegmentedTone, string> = {
  sky: 'rounded-lg bg-neutral-100/80 p-0.5 dark:bg-neutral-800/60',
  neutral: 'rounded-[10px] bg-black/[0.045] p-[3px] dark:bg-white/[0.07]',
}

const OPTION_CLASS: Record<SegmentedTone, { active: string; idle: string }> = {
  sky: {
    active: 'bg-sky-100/80 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    idle: 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
  },
  neutral: {
    active:
      'bg-white text-neutral-900 shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.04)] dark:bg-white/[0.14] dark:text-white dark:shadow-none',
    idle: 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
  },
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  tone = 'sky',
  className,
}: {
  label: string
  value: T
  /** title：悬停时的补充说明。 */
  options: readonly {
    value: T
    label: string
    count?: number
    title?: string
    icon?: ComponentType<{ className?: string }>
  }[]
  onChange: (value: T) => void
  tone?: SegmentedTone
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        'hc-scrollbar inline-flex max-w-full shrink-0 items-center gap-0.5 overflow-x-auto',
        TRACK_CLASS[tone],
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={clsx(
              'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[13px] leading-4 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/50',
              tone === 'neutral' ? 'min-h-7 rounded-[7px]' : 'min-h-8 rounded-md',
              value === option.value ? OPTION_CLASS[tone].active : OPTION_CLASS[tone].idle,
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {option.label}
            {option.count != null && (
              <span className="text-[11px] tabular-nums opacity-70">{option.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
