import { clsx } from 'clsx'

/** 会话操作菜单条目：侧栏行内三点菜单与聊天顶栏三点菜单共用。 */
export function RowMenuItem({
  icon,
  onClick,
  children,
  danger,
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] leading-5 transition',
        danger
          ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800',
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>
      <span className="flex min-h-5 items-center leading-5">{children}</span>
    </button>
  )
}
