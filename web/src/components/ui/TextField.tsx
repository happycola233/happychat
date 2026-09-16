import { clsx } from 'clsx'
import type { InputHTMLAttributes } from 'react'
import { fieldLabelClass, inputClass } from './controlStyles'

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
      {label && <span className={fieldLabelClass}>{label}</span>}
      <input
        className={clsx(
          'w-full outline-none transition placeholder:text-neutral-400 dark:text-neutral-100',
          variant === 'filled'
            ? 'rounded-lg border border-transparent bg-neutral-100 px-3 py-2 text-sm hover:bg-neutral-200/60 focus:border-neutral-300 focus:bg-white focus:ring-2 focus:ring-neutral-900/5 dark:bg-neutral-800 dark:hover:bg-neutral-700/60 dark:focus:border-neutral-600 dark:focus:bg-neutral-900 dark:focus:ring-white/5'
            : inputClass,
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
