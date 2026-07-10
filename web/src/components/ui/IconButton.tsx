import { clsx } from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

type Tone = 'default' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍名称（同时用作悬停 title）。 */
  label: string
  tone?: Tone
}

/**
 * 统一的方形图标按钮（行内操作用）：固定 8×8 尺寸保证同行按钮天然对齐，
 * danger 色调悬停转红，禁用降透明度。
 */
export function IconButton({ label, tone = 'default', className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent',
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
