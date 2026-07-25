import { clsx } from 'clsx'
import type { ReactNode } from 'react'

/**
 * 设置弹窗内的分区卡片：标题 + 说明 + 内容。
 * 与管理页 `Card` 的区别是无底色/投影、字号更紧凑，适配设置弹窗的窄栏排版。
 */
export function SectionCard({
  title,
  description,
  danger,
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
        'rounded-2xl border p-4',
        danger
          ? 'border-red-200 dark:border-red-900/40'
          : 'border-neutral-200 dark:border-neutral-800',
      )}
    >
      <h4 className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">{title}</h4>
      {description && (
        <p className="mt-0.5 text-[12px] leading-5 text-neutral-400 dark:text-neutral-500">
          {description}
        </p>
      )}
      <div className="mt-3.5">{children}</div>
    </section>
  )
}
