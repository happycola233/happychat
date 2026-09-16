import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Boxes, Search, UserRound } from 'lucide-react'
import { clsx } from 'clsx'
import { listAdminModels, listUsers } from '../../api/admin'
import { Modal } from '../../components/ui/Modal'

/** 导航与实体搜索共享一个入口；只在打开面板时读取管理目录。 */
export function AdminQuickSwitch({
  pages,
  onClose,
}: {
  pages: { to: string; label: string; group: string }[]
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const { data: models } = useQuery({ queryKey: ['admin', 'models'], queryFn: listAdminModels })
  const { data: users } = useQuery({ queryKey: ['admin', 'users'], queryFn: listUsers })
  const keyword = query.trim().toLocaleLowerCase()
  const matches = (text: string) => text.toLocaleLowerCase().includes(keyword)
  const items = [
    ...pages
      .filter((page) => matches(`${page.label} ${page.group}`))
      .map((page) => ({
        title: page.label,
        detail: page.group,
        href: `/admin/${page.to}`,
        icon: ArrowUpRight,
      })),
    ...(keyword
      ? (models ?? [])
          .filter((model) => matches(`${model.displayName} ${model.modelId} ${model.providerName}`))
          .slice(0, 8)
          .map((model) => ({
            title: model.displayName,
            detail: `配置模型 · ${model.providerName}`,
            href: `/admin/models?edit=${encodeURIComponent(model.id)}`,
            icon: Boxes,
          }))
      : []),
    ...(keyword
      ? (users ?? [])
          .filter((user) => matches(`${user.username} ${user.displayName ?? ''}`))
          .slice(0, 8)
          .map((user) => ({
            title: user.displayName || user.username,
            detail: `用户 · ${user.username}`,
            href: `/admin/users/${user.id}`,
            icon: UserRound,
          }))
      : []),
  ]
  const activeIndex = Math.min(active, Math.max(0, items.length - 1))
  const openItem = (index: number) => {
    const item = items[index]
    if (!item) return
    navigate(item.href)
    onClose()
  }
  return (
    <Modal
      open
      title="快速前往"
      onClose={onClose}
      bodyClassName="min-h-0 overflow-hidden p-3"
      footer={
        <span className="mr-auto text-xs text-neutral-400">↑ ↓ 选择 · Enter 打开 · Esc 关闭</span>
      }
    >
      <div className="relative mb-2">
        <Search aria-hidden className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
        <input
          autoFocus
          role="combobox"
          aria-label="搜索页面、模型或用户"
          aria-expanded="true"
          aria-controls="admin-quick-results"
          aria-autocomplete="list"
          aria-activedescendant={items.length ? `admin-quick-${activeIndex}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          placeholder="搜索页面、模型或用户…"
          className="h-10 w-full rounded-lg bg-neutral-100 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-sky-500/30 dark:bg-neutral-800 dark:text-neutral-100"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              openItem(activeIndex)
            }
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
              event.preventDefault()
              const next =
                (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
              setActive(next)
              document.getElementById(`admin-quick-${next}`)?.scrollIntoView({ block: 'nearest' })
            }
          }}
        />
      </div>
      <div
        id="admin-quick-results"
        role="listbox"
        aria-label="搜索结果"
        className="hc-scrollbar max-h-[55dvh] overflow-y-auto"
      >
        {items.map((item, index) => (
          <button
            key={item.href}
            id={`admin-quick-${index}`}
            role="option"
            aria-selected={activeIndex === index}
            tabIndex={-1}
            type="button"
            onClick={() => openItem(index)}
            className={clsx(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
              activeIndex === index
                ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
                : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800',
            )}
          >
            <item.icon className="h-4 w-4 shrink-0 text-neutral-400" />
            <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            <span className="max-w-[45%] truncate text-xs text-neutral-400">{item.detail}</span>
          </button>
        ))}
        {items.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-neutral-500">
            没有找到匹配的页面、模型或用户
          </p>
        )}
      </div>
    </Modal>
  )
}
