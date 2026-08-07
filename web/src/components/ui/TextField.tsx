import { clsx } from 'clsx'
import type { InputHTMLAttributes } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  /** filled：无边框填充式，适合设置面板等低干扰场景；默认 outline 描边式。 */
  variant?: 'outline' | 'filled'
}

export function TextField({ label, error, hint, variant = 'outline', className, ...rest }: Props) {
  return (
    <label className="block">
      {label && (
        <span
          className={clsx(
            'block font-medium',
            variant === 'filled'
              ? 'mb-1 text-xs text-neutral-500 dark:text-neutral-400'
              : 'mb-1.5 text-sm text-neutral-700 dark:text-neutral-300',
          )}
        >
          {label}
        </span>
      )}
      <input
        className={clsx(
          'w-full text-sm outline-none transition placeholder:text-neutral-400 dark:text-neutral-100',
          variant === 'filled'
            ? 'rounded-lg border border-transparent bg-neutral-100 px-3 py-2 hover:bg-neutral-200/60 focus:border-neutral-300 focus:bg-white focus:ring-2 focus:ring-neutral-900/5 dark:bg-neutral-800 dark:hover:bg-neutral-700/60 dark:focus:border-neutral-600 dark:focus:bg-neutral-900 dark:focus:ring-white/5'
            : 'rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-sky-400',
          error && 'border-red-400 focus:border-red-500 focus:ring-red-500/10',
          className,
        )}
        {...rest}
      />
      {error ? (
        <span className="mt-1 block text-xs text-red-500">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-neutral-400">{hint}</span>
      ) : null}
    </label>
  )
}
