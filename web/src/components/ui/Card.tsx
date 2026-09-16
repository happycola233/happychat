import { clsx } from 'clsx'
import type { ReactNode } from 'react'

/** 用浅底色区分区域，不叠加描边和投影。嵌套内容优先直接排版。 */
export const cardSurface = 'rounded-xl bg-neutral-50 dark:bg-neutral-900/60'

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
    <section className={clsx(cardSurface, padded && 'p-4', className)}>
      {(title || description) && (
        <header className={clsx('mb-3', !padded && 'px-4 pt-4')}>
          {title && (
            <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
              {title}
            </h2>
          )}
          {description && (
            <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              {description}
            </p>
          )}
        </header>
      )}
      {children}
    </section>
  )
}
