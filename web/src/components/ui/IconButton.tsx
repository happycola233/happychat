import { clsx } from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

type Tone = 'default' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍名称（同时用作悬停 title）。 */
  label: string
  tone?: Tone
  variant?: 'inline' | 'toolbar'
}

/**
 * 统一 32px 点击区域；顶栏图标为 18px，开合、悬停和焦点样式一致。
 */
export function IconButton({
  label,
  tone = 'default',
  variant = 'inline',
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent',
        variant === 'toolbar'
          ? 'text-neutral-500 aria-expanded:bg-neutral-100 dark:text-neutral-400 dark:aria-expanded:bg-neutral-800 [&>svg]:h-4.5 [&>svg]:w-4.5'
          : 'text-neutral-400',
        tone === 'default' &&
          'hover:bg-neutral-100 hover:text-neutral-700 focus-visible:ring-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
        tone === 'danger' &&
          'hover:bg-red-50 hover:text-red-600 focus-visible:ring-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-400',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
