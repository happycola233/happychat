import { clsx } from 'clsx'
import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-neutral-900',
        variant === 'primary' &&
          'bg-sky-500 text-white shadow-xs hover:bg-sky-400 focus-visible:ring-sky-500/50 active:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400',
        variant === 'secondary' &&
          'border border-neutral-300 bg-white text-neutral-800 shadow-xs hover:bg-neutral-50 focus-visible:ring-neutral-400/50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:shadow-none dark:hover:bg-neutral-700',
        variant === 'ghost' &&
          'text-neutral-600 hover:bg-neutral-100 focus-visible:ring-neutral-400/50 dark:text-neutral-300 dark:hover:bg-neutral-800',
        variant === 'danger' &&
          'bg-red-600 text-white shadow-xs hover:bg-red-500 focus-visible:ring-red-500/50',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  )
}
