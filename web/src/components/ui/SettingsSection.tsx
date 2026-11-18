import { clsx } from 'clsx'
import type { ReactNode } from 'react'

/**
 * 设置页的分组：只用加粗标题、留白与行间细分隔线建立层级，不套卡片、不叠底色和边框，
 * 让设置页保持轻盈。危险操作仅把标题标红，破坏性按钮自身的红色已足够醒目。
 */
export function SettingsSection({
  title,
  description,
  action,
  danger = false,
  children,
}: {
  title?: string
  description?: ReactNode
  /** 标题行右侧的轻量操作（如「复制」）。 */
  action?: ReactNode
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section className="min-w-0">
      {(title || action) && (
        <div className="flex min-h-6 items-end justify-between gap-3">
          {title && (
            <h3
              className={clsx(
                'text-[15px] font-semibold leading-6',
                danger
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-neutral-900 dark:text-neutral-100',
              )}
            >
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      {description && (
        <p className="mt-1 text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
          {description}
        </p>
      )}
      <div className="mt-1.5 divide-y divide-black/[0.06] dark:divide-white/[0.07]">{children}</div>
    </section>
  )
}
