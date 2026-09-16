import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
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
  Menu,
  Monitor,
  Moon,
  Sun,
  Server,
  Settings,
  Search,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '../../components/ui/Spinner'
import { Modal } from '../../components/ui/Modal'
import { ShareIcon, SidebarToggleIcon } from '../../chat/icons'
import { useAdminSidebarStore } from '../../store/adminSidebar'
import { useSettings } from '../../store/settings'
import { AdminQuickSwitch } from './AdminQuickSwitch'

/** 桌面与手机共用同一份分组，所有入口在窄屏也能直接找到。 */
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
      { to: 'providers', label: '供应商', icon: Server },
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

function ThemeToggle() {
  const theme = useSettings((state) => state.theme)
  const setTheme = useSettings((state) => state.setTheme)
  const [open, setOpen] = useState(false)
  const options = [
    { value: 'system', label: '跟随系统', icon: Monitor },
    { value: 'light', label: '浅色', icon: Sun },
    { value: 'dark', label: '深色', icon: Moon },
  ] as const
  const current = options.find((option) => option.value === theme)!
  return (
    <>
      <button
        type="button"
        className={iconActionClass}
        aria-label={`外观：${current.label}`}
        title={`外观：${current.label}`}
        onClick={() => setOpen(true)}
      >
        <current.icon className="h-4 w-4" />
      </button>
      {open && (
        <Modal open title="外观" onClose={() => setOpen(false)}>
          <div role="group" aria-label="外观主题" className="grid grid-cols-3 gap-2">
            {options.map(({ value, label, icon: Icon }) => (
              <button
                type="button"
                key={value}
                aria-pressed={theme === value}
                onClick={() => {
                  setTheme(value)
                  setOpen(false)
                }}
                className={clsx(
                  'flex flex-col items-center gap-2 rounded-lg px-2 py-4 text-xs transition',
                  theme === value
                    ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
                    : 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-800/60 dark:text-neutral-300 dark:hover:bg-neutral-800',
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
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

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
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
  onSearch,
}: {
  collapsed: boolean
  onToggle: () => void
  onSearch: () => void
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
        'hidden shrink-0 flex-col bg-neutral-50 md:flex dark:bg-neutral-900/60',
        'transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        collapsed ? 'w-16 overflow-visible' : 'w-54 overflow-hidden',
      )}
    >
      {collapsed ? (
        <div className="hc-sidebar-rail-in flex min-w-16 flex-1 flex-col items-center px-2 py-3">
          <CollapseToggle collapsed onToggle={handleToggle} />
          <div className="mt-1">
            <BackToChatLink onShowTip={showTip} onHideTip={hideTip} />
          </div>
          <button
            type="button"
            onClick={onSearch}
            className={iconActionClass}
            aria-label="快速前往（Ctrl K）"
            title="快速前往（Ctrl K）"
          >
            <Search className="h-4 w-4" />
          </button>
          <nav
            id="admin-sidebar-nav"
            className="hc-scrollbar mt-3 flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto"
            onScroll={hideTip}
          >
            {navGroups.map((group, index) => (
              <div key={group.label} className="flex flex-col items-center gap-0.5">
                {index > 0 && (
                  <div aria-hidden className="my-2 h-px w-6 bg-neutral-200 dark:bg-neutral-700" />
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
        <div className="hc-sidebar-panel-in flex min-h-0 min-w-54 flex-1 flex-col p-3">
          <div className="mb-4 flex items-center gap-1">
            <BackToChatLink onShowTip={showTip} onHideTip={hideTip} />
            <h2 className="min-w-0 flex-1 truncate px-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              管理后台
            </h2>
            <CollapseToggle collapsed={false} onToggle={handleToggle} />
          </div>
          <button
            type="button"
            onClick={onSearch}
            className="mb-4 flex min-h-9 items-center gap-2 rounded-lg bg-neutral-100 px-3 text-xs text-neutral-500 transition hover:bg-neutral-200/70 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">快速前往</span>
            <kbd className="text-[10px]">Ctrl K</kbd>
          </button>
          <nav
            aria-label="后台导航"
            id="admin-sidebar-nav"
            className="hc-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto"
          >
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
      <div
        className={clsx(
          'flex shrink-0 items-center py-2',
          collapsed ? 'justify-center' : 'justify-between px-5',
        )}
      >
        {!collapsed && (
          <span className="text-[11px] font-medium tracking-wide text-neutral-400 dark:text-neutral-500">
            HappyChat
          </span>
        )}
        <ThemeToggle />
      </div>
      <RailTooltip tip={tip} />
    </aside>
  )
}

export default function AdminLayout() {
  const collapsed = useAdminSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useAdminSidebarStore((s) => s.toggleCollapsed)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [quickSwitchOpen, setQuickSwitchOpen] = useState(false)
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const currentPage =
    navGroups
      .flatMap((group) => group.items)
      .find((item) => location.pathname.startsWith(`/admin/${item.to}`))?.label ?? '用户详情'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      if (document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      setQuickSwitchOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    // h-dvh + overflow-hidden：侧栏/顶部导航固定，只有右侧内容区（main）滚动。
    <div className="hc-admin flex h-dvh flex-col overflow-hidden bg-white text-neutral-900 md:flex-row dark:bg-neutral-950 dark:text-neutral-100">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-sky-100 focus:px-4 focus:py-2 focus:text-sky-900"
      >
        跳转到主要内容
      </a>
      <div className="z-20 shrink-0 bg-neutral-50 md:hidden dark:bg-neutral-900">
        <div className="flex h-12 items-center gap-1 px-3">
          <BackToChatLink />
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-neutral-700 dark:text-neutral-200">
            <span className="font-normal text-neutral-500">管理后台</span>
            <span aria-hidden className="mx-2 text-neutral-300 dark:text-neutral-600">
              /
            </span>
            {currentPage}
          </span>
          <button
            type="button"
            className={iconActionClass}
            aria-label="快速前往"
            onClick={() => setQuickSwitchOpen(true)}
          >
            <Search className="h-4 w-4" />
          </button>
          <ThemeToggle />
          <button
            type="button"
            className={iconActionClass}
            aria-label="打开后台导航"
            aria-haspopup="dialog"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>
      <Modal open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} title="后台导航">
        <nav aria-label="手机后台导航" className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-xs text-neutral-500">{group.label}</p>
              <div className="grid grid-cols-2 gap-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileNavOpen(false)}
                    className={({ isActive }) => itemClass(isActive, false)}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </Modal>

      <DesktopSidebar
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onSearch={() => setQuickSwitchOpen(true)}
      />
      {quickSwitchOpen && (
        <AdminQuickSwitch
          pages={navGroups.flatMap((group) =>
            group.items.map((item) => ({ to: item.to, label: item.label, group: group.label })),
          )}
          onClose={() => setQuickSwitchOpen(false)}
        />
      )}

      <main
        ref={mainRef}
        id="admin-main"
        tabIndex={-1}
        className="hc-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto p-4 outline-none sm:p-5 lg:px-7 lg:py-6"
      >
        <div className="mx-auto w-full max-w-[1600px]">
          <Suspense
            fallback={
              <div className="py-16 text-center">
                <Spinner className="h-6 w-6 text-neutral-400" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
