import { clsx } from 'clsx'
import type { SelectHTMLAttributes } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: SelectOption[]
}

export function Select({ label, options, className, ...rest }: Props) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {label}
        </span>
      )}
      <select
        className={clsx(
          'rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-400',
          className,
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
