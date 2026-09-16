import { clsx } from 'clsx'
import { RANGE_PRESETS, type RangeKey } from '../../lib/dateRange'

export function DateRangePicker({
  value,
  onChange,
}: {
  value: RangeKey
  onChange: (key: RangeKey) => void
}) {
  return (
    <div
      role="group"
      aria-label="统计时间范围"
      className="inline-flex max-w-full gap-0.5 rounded-lg bg-neutral-100/70 p-0.5 dark:bg-neutral-900"
    >
      {RANGE_PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-pressed={value === p.key}
          onClick={() => onChange(p.key)}
          className={clsx(
            'min-h-8 rounded-md px-2.5 py-1 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 sm:px-3',
            value === p.key
              ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300'
              : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
