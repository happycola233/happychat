import type { ComponentType, ReactNode } from 'react'

/**
 * 统一空状态：虚线卡片 + 可选图标与操作按钮。
 * 替代各页手写的「rounded-2xl border-dashed …」块，保持文案与留白一致。
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
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
      {Icon && <Icon className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />}
      <div className="text-sm text-neutral-500 dark:text-neutral-400">{title}</div>
      {action}
    </div>
  )
}
