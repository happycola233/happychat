import { clsx } from 'clsx'
import type { ReactNode } from 'react'

/**
 * 设置页的语义分区：默认只用标题与留白建立层级，避免每组内容都套一层卡片。
 * 危险操作仍保留低对比度警示容器，防止破坏性按钮混入普通设置。
 */
export function SettingsSection({
  title,
  description,
  danger = false,
  children,
}: {
  title: string
  description?: ReactNode
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={clsx(
        danger
          ? 'mt-4 rounded-2xl border border-red-200/80 bg-red-50/35 p-4 dark:border-red-900/45 dark:bg-red-950/10'
          : 'pt-4 first:pt-1',
      )}
    >
      <h3
        className={clsx(
          'font-medium',
          danger
            ? 'text-[13px] text-red-600 dark:text-red-400'
            : 'pb-0.5 text-xs text-neutral-400 dark:text-neutral-500',
        )}
      >
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 text-[12px] leading-5 text-neutral-400 dark:text-neutral-500">
          {description}
        </p>
      )}
      <div
        className={clsx(danger ? 'mt-1.5' : 'divide-y divide-neutral-100 dark:divide-neutral-800')}
      >
        {children}
      </div>
    </section>
  )
}
