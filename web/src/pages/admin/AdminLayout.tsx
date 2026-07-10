import { Suspense } from 'react'
import { clsx } from 'clsx'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  LayoutDashboard,
  Megaphone,
  Server,
  Settings,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Spinner } from '../../components/ui/Spinner'
import { ShareIcon } from '../../chat/icons'

/** 侧边导航按职责分组（参考现代面板惯例），移动端横滑标签时展平。 */
const navGroups = [
  {
    label: '洞察',
    items: [
      { to: 'overview', label: '概览', icon: LayoutDashboard },
      { to: 'analytics', label: '分析', icon: TrendingUp },
    ],
  },
  {
    label: '事件',
    items: [
      { to: 'request-events', label: '请求事件', icon: Activity },
      { to: 'error-logs', label: '错误日志', icon: AlertTriangle },
    ],
  },
  {
    label: '运营',
    items: [
      { to: 'auth-center', label: '账号中心', icon: Users },
      { to: 'shares', label: '分享管理', icon: ShareIcon },
      { to: 'announcements', label: '公告', icon: Megaphone },
    ],
  },
  {
    label: '接入',
    items: [
      { to: 'providers', label: '提供商', icon: Server },
      { to: 'models', label: '模型', icon: Boxes },
    ],
  },
  {
    label: '系统',
    items: [{ to: 'settings', label: '系统设置', icon: Settings }],
  },
]

const itemClass = (isActive: boolean) =>
  clsx(
    'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
    isActive
      ? 'bg-sky-50 font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300'
      : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100',
  )

export default function AdminLayout() {
  return (
    // h-dvh + overflow-hidden：侧栏/顶部导航固定，只有右侧内容区（main）滚动。
    <div className="flex h-dvh flex-col overflow-hidden bg-neutral-50 md:flex-row dark:bg-neutral-950">
      {/* 移动端顶部导航（布局高度已固定，无需 sticky） */}
      <div className="z-20 shrink-0 border-b border-neutral-200 bg-white md:hidden dark:border-neutral-800 dark:bg-neutral-900">
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
          {navGroups.flatMap((group) =>
            group.items.map((it) => (
              <NavLink key={it.to} to={it.to} className={({ isActive }) => itemClass(isActive)}>
                <it.icon className="h-4 w-4" />
                {it.label}
              </NavLink>
            )),
          )}
        </nav>
      </div>

      {/* 桌面左侧导航 */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white p-4 md:flex dark:border-neutral-800 dark:bg-neutral-900">
        <Link
          to="/"
          className="mb-5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <ArrowLeft className="h-4 w-4" /> 返回聊天
        </Link>
        <h2 className="mb-4 px-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
          管理后台
        </h2>
        <nav className="hc-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase dark:text-neutral-500">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) => itemClass(isActive)}
                  >
                    <it.icon className="h-4 w-4" />
                    {it.label}
                  </NavLink>
                ))}
              </div>
            </div>
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
