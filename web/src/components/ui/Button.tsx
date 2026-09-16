import { clsx } from 'clsx'
import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'primary',
  loading = false,
  size = 'md',
  disabled,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] leading-4 font-medium transition select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-neutral-900',
        size === 'sm' ? 'min-h-8' : 'min-h-9',
        variant === 'primary' &&
          'bg-sky-600 text-white hover:bg-sky-500 focus-visible:ring-sky-500/50 active:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-500',
        variant === 'secondary' &&
          'bg-neutral-100 text-neutral-800 hover:bg-neutral-200/70 focus-visible:ring-neutral-400/50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700',
        variant === 'ghost' &&
          'text-neutral-600 hover:bg-neutral-100 focus-visible:ring-neutral-400/50 dark:text-neutral-300 dark:hover:bg-neutral-800',
        variant === 'danger' &&
          'bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500/50',
        variant === 'accent' &&
          'bg-[var(--hc-accent-strong)] text-[var(--hc-accent-strong-fg)] hover:brightness-95 focus-visible:ring-neutral-400/50',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  )
}
