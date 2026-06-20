import { Suspense } from 'react'
import { clsx } from 'clsx'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  LayoutDashboard,
  Server,
  Settings,
  Share2,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Spinner } from '../../components/ui/Spinner'

const navItems = [
  { to: 'overview', label: '概览', icon: LayoutDashboard },
  { to: 'analytics', label: '分析', icon: TrendingUp },
  { to: 'request-events', label: '请求事件', icon: Activity },
  { to: 'error-logs', label: '错误日志', icon: AlertTriangle },
  { to: 'auth-center', label: '账号中心', icon: Users },
  { to: 'shares', label: '分享管理', icon: Share2 },
  { to: 'providers', label: '提供商', icon: Server },
  { to: 'models', label: '模型', icon: Boxes },
  { to: 'settings', label: '系统设置', icon: Settings },
]

const itemClass = (isActive: boolean) =>
  clsx(
    'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
    isActive
      ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
  )

export default function AdminLayout() {
  return (
    <div className="flex min-h-full flex-col bg-neutral-50 md:flex-row dark:bg-neutral-950">
      {/* 移动端顶部导航 */}
      <div className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-900/95">
        <div className="flex h-12 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-200"
          >
            <ArrowLeft className="h-4 w-4" /> 返回聊天
          </Link>
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
            管理后台
          </span>
        </div>
        <nav className="hc-scrollbar-hidden flex gap-1 overflow-x-auto px-3 py-2">
          {navItems.map((it) => (
            <NavLink key={it.to} to={it.to} className={({ isActive }) => itemClass(isActive)}>
              <it.icon className="h-4 w-4" />
              {it.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* 桌面左侧导航 */}
      <aside className="hidden w-56 shrink-0 border-r border-neutral-200 bg-white p-4 md:block dark:border-neutral-800 dark:bg-neutral-900">
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
            <NavLink key={it.to} to={it.to} className={({ isActive }) => itemClass(isActive)}>
              <it.icon className="h-4 w-4" />
              {it.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="hc-scrollbar flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <Suspense
          fallback={
            <div className="py-16 text-center">
              <Spinner className="h-6 w-6 text-neutral-400" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
