import type { ComponentType, ReactNode } from 'react'

/**
 * 统一空状态，保留清晰的说明和下一步操作。
 */
export function EmptyState({
  icon: Icon,
  title,
  action,
}: {
  icon?: ComponentType<{ className?: string }>
  title: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-neutral-50 px-4 py-10 text-center dark:bg-neutral-900/60">
      {Icon && <Icon className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />}
      <div className="text-sm text-neutral-500 dark:text-neutral-400">{title}</div>
      {action}
    </div>
  )
}
