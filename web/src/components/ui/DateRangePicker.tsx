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
    <div className="inline-flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
      {RANGE_PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.key)}
          className={clsx(
            'rounded-md px-3 py-1 text-[13px] font-medium transition',
            value === p.key
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white'
              : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
