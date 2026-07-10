import { clsx } from 'clsx'
import type { ReactNode } from 'react'

/** 管理页统一卡片表面：白底圆角 + hairline 描边 + 极浅投影，深色为深灰表面（无投影）。 */
export const cardSurface =
  'rounded-2xl border border-neutral-200 bg-white shadow-xs dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none'

/**
 * 分区卡片：可选标题/说明 + 内容。管理页所有「设置块」共用，
 * 与参考风格一致：卡片承载一组相关配置，标题在卡片内部而非游离在外。
 */
export function Card({
  title,
  description,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
  /** false 时内容区自己控制内边距（如内嵌列表/表格贴边）。 */
  padded?: boolean
}) {
  return (
    <section className={clsx(cardSurface, padded && 'p-5', className)}>
      {(title || description) && (
        <header className={clsx('mb-4', !padded && 'px-5 pt-5')}>
          {title && (
            <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
              {title}
            </h2>
          )}
          {description && (
            <p className="mt-1 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
              {description}
            </p>
          )}
        </header>
      )}
      {children}
    </section>
  )
}
