import { clsx } from 'clsx'
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  ScrollText,
  Server,
  Settings,
  Ticket,
  Users,
} from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: 'stats', label: '统计', icon: BarChart3 },
  { to: 'providers', label: '提供商', icon: Server },
  { to: 'models', label: '模型', icon: Boxes },
  { to: 'users', label: '用户', icon: Users },
  { to: 'invites', label: '邀请码', icon: Ticket },
  { to: 'logs', label: '错误日志', icon: ScrollText },
  { to: 'settings', label: '系统设置', icon: Settings },
]

export default function AdminLayout() {
  return (
    <div className="flex min-h-full bg-neutral-50 dark:bg-neutral-950">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <Link
          to="/"
          className="mb-6 flex items-center gap-2 text-sm text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-200"
        >
          <ArrowLeft className="h-4 w-4" /> 返回聊天
        </Link>
        <h2 className="mb-3 px-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
          管理后台
        </h2>
        <nav className="space-y-1">
          {navItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
                  isActive
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                )
              }
            >
              <it.icon className="h-4 w-4" />
              {it.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="hc-scrollbar flex-1 overflow-y-auto p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}
