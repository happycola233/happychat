import { Suspense, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Gauge,
  LayoutDashboard,
  Layers3,
  Megaphone,
  Server,
  Settings,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Spinner } from '../../components/ui/Spinner'
import { ShareIcon, SidebarToggleIcon } from '../../chat/icons'
import { useAdminSidebarStore } from '../../store/adminSidebar'

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
      { to: 'quotas', label: '用户限额', icon: Gauge },
      { to: 'shares', label: '分享管理', icon: ShareIcon },
      { to: 'announcements', label: '公告', icon: Megaphone },
    ],
  },
  {
    label: '接入',
    items: [
      { to: 'providers', label: '提供商', icon: Server },
      { to: 'models', label: '模型', icon: Boxes },
      { to: 'model-groups', label: '模型分组', icon: Layers3 },
    ],
  },
  {
    label: '系统',
    items: [{ to: 'settings', label: '系统设置', icon: Settings }],
  },
]

const itemClass = (isActive: boolean, collapsed: boolean) =>
  clsx(
    'flex shrink-0 items-center rounded-lg text-sm transition',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
    collapsed ? 'h-8 w-8 justify-center' : 'gap-2.5 px-3 py-2',
    isActive
      ? 'bg-sky-50 font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300'
      : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100',
  )

const iconActionClass =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'

interface RailTip {
  label: string
  top: number
  left: number
}

function BackToChatLink({
  onShowTip,
  onHideTip,
}: {
  onShowTip?: (label: string, target: EventTarget | null) => void
  onHideTip?: () => void
}) {
  return (
    <Link
      to="/"
      aria-label="返回聊天"
      className={iconActionClass}
      onMouseEnter={onShowTip ? (event) => onShowTip('返回聊天', event.currentTarget) : undefined}
      onMouseLeave={onHideTip}
      onFocus={onShowTip ? (event) => onShowTip('返回聊天', event.currentTarget) : undefined}
      onBlur={onHideTip}
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="sr-only">返回聊天</span>
    </Link>
  )
}

function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      data-testid="admin-sidebar-toggle"
      aria-expanded={!collapsed}
      aria-controls="admin-sidebar-nav"
      aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
      title={collapsed ? '展开侧边栏' : '收起侧边栏'}
      onClick={onToggle}
      className={iconActionClass}
    >
      <SidebarToggleIcon className="h-5 w-5" />
    </button>
  )
}

function RailTooltip({ tip }: { tip: RailTip | null }) {
  if (!tip || typeof document === 'undefined') return null
  return createPortal(
    <div
      role="tooltip"
      className="hc-pop-in pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
      style={{ top: tip.top, left: tip.left }}
    >
      {tip.label}
    </div>,
    document.body,
  )
}

function DesktopSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  const [tip, setTip] = useState<RailTip | null>(null)

  const showTip = useCallback((label: string, target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return
    const rect = target.getBoundingClientRect()
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 })
  }, [])

  const hideTip = useCallback(() => setTip(null), [])
  const handleToggle = useCallback(() => {
    hideTip()
    onToggle()
  }, [hideTip, onToggle])

  return (
    <aside
      data-testid="admin-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={clsx(
        'hidden shrink-0 flex-col border-r border-neutral-200 bg-white md:flex dark:border-neutral-800 dark:bg-neutral-900',
        'transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        collapsed ? 'w-16 overflow-visible' : 'w-60 overflow-hidden',
      )}
    >
      {collapsed ? (
        <div className="hc-sidebar-rail-in flex min-w-16 flex-1 flex-col items-center px-2 py-3">
          <CollapseToggle collapsed onToggle={handleToggle} />
          <div className="mt-1">
            <BackToChatLink onShowTip={showTip} onHideTip={hideTip} />
          </div>
          <nav
            id="admin-sidebar-nav"
            className="hc-scrollbar mt-3 flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto"
            onScroll={hideTip}
          >
            {navGroups.map((group, index) => (
              <div key={group.label} className="flex flex-col items-center gap-0.5">
                {index > 0 && (
                  <div
                    aria-hidden
                    className="my-2 h-px w-6 bg-neutral-200 dark:bg-neutral-700"
                  />
                )}
                {group.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) => itemClass(isActive, true)}
                    onMouseEnter={(event) => showTip(it.label, event.currentTarget)}
                    onMouseLeave={hideTip}
                    onFocus={(event) => showTip(it.label, event.currentTarget)}
                    onBlur={hideTip}
                  >
                    <it.icon className="h-4 w-4" />
                    <span className="sr-only">{it.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </div>
      ) : (
        <div className="hc-sidebar-panel-in flex h-full min-w-60 flex-col p-4">
          <div className="mb-4 flex items-center gap-1">
            <BackToChatLink onShowTip={showTip} onHideTip={hideTip} />
            <h2 className="min-w-0 flex-1 truncate px-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              管理后台
            </h2>
            <CollapseToggle collapsed={false} onToggle={handleToggle} />
          </div>
          <nav id="admin-sidebar-nav" className="hc-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto">
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
                      className={({ isActive }) => itemClass(isActive, false)}
                    >
                      <it.icon className="h-4 w-4 shrink-0" />
                      {it.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      )}
      <RailTooltip tip={tip} />
    </aside>
  )
}

export default function AdminLayout() {
  const collapsed = useAdminSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useAdminSidebarStore((s) => s.toggleCollapsed)

  return (
    // h-dvh + overflow-hidden：侧栏/顶部导航固定，只有右侧内容区（main）滚动。
    <div className="flex h-dvh flex-col overflow-hidden bg-neutral-50 md:flex-row dark:bg-neutral-950">
      {/* 移动端顶部导航（布局高度已固定，无需 sticky） */}
      <div className="z-20 shrink-0 border-b border-neutral-200 bg-white md:hidden dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex h-12 items-center gap-1 border-b border-neutral-200 px-3 dark:border-neutral-800">
          <BackToChatLink />
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
            管理后台
          </span>
        </div>
        <nav className="hc-scrollbar-hidden flex gap-1 overflow-x-auto px-3 py-2">
          {navGroups.flatMap((group) =>
            group.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                className={({ isActive }) => itemClass(isActive, false)}
              >
                <it.icon className="h-4 w-4" />
                {it.label}
              </NavLink>
            )),
          )}
        </nav>
      </div>

      <DesktopSidebar collapsed={collapsed} onToggle={toggleCollapsed} />

      <main className="hc-scrollbar min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
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
