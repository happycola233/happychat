import { clsx } from 'clsx'

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string; count?: number }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        'hc-scrollbar inline-flex max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-neutral-100/80 p-0.5 dark:bg-neutral-800/60',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] leading-4 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/50',
            value === option.value
              ? 'bg-sky-100/80 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
              : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
          )}
        >
          {option.label}
          {option.count != null && (
            <span className="text-[11px] tabular-nums opacity-70">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}
