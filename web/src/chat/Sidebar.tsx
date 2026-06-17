import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ConversationDTO } from '@shared/types/api'
import {
  ChevronDown,
  LogOut,
  Moon,
  PanelLeft,
  Pin,
  PinOff,
  Search,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteConversation, pinConversation } from '../api/chat'
import { useConversations } from '../hooks/useConversations'
import { useLogout, useMe } from '../hooks/useAuth'
import { useSidebarStore } from '../store/sidebar'
import { toast } from '../store/toast'
import { useTheme } from '../store/theme'
import { ChatBubbleIcon, NewChatIcon, RoutineIcon } from './icons'
import { SearchDialog } from './SearchDialog'

type PopoverKind = 'pinned' | 'recent'

function titleOf(conversation: ConversationDTO): string {
  return conversation.title ?? '新聊天'
}

function Avatar({ label }: { label: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-300 via-indigo-300 to-fuchsia-300 text-xs font-semibold text-white shadow-sm">
      {label.slice(0, 1).toLocaleUpperCase()}
    </span>
  )
}

function AccountMenu({
  userLabel,
  isAdmin,
  onClose,
  onLogout,
}: {
  userLabel: string
  isAdmin: boolean
  onClose: () => void
  onLogout: () => void
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <Avatar label={userLabel} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
            {userLabel}
          </div>
          <div className="truncate text-xs text-neutral-400">
            {isAdmin ? '管理员' : 'Plus'}
          </div>
        </div>
      </div>

      <div className="my-2 border-t border-neutral-200 dark:border-neutral-800" />

      {isAdmin && (
        <Link
          to="/admin"
          onClick={onClose}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] text-neutral-900 transition hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          <Settings className="h-4 w-4" />
          管理
        </Link>
      )}
      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] text-neutral-900 transition hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
      >
        <LogOut className="h-4 w-4" />
        退出登录
      </button>
    </div>
  )
}

function RailButton({
  title,
  active,
  onClick,
  children,
  testId,
  popoverTrigger,
}: {
  title: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  testId?: string
  popoverTrigger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      data-rail-trigger={popoverTrigger ? 'true' : undefined}
      onClick={onClick}
      className={clsx(
        'group relative flex h-9 w-9 items-center justify-center rounded-lg text-neutral-900 transition dark:text-neutral-100',
        active ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-200/70 dark:hover:bg-neutral-800',
      )}
    >
      {children}
      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2.5 -translate-y-1/2 whitespace-nowrap rounded-lg bg-black px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-lg transition group-hover:opacity-100">
        {title}
      </span>
    </button>
  )
}

function NavButton({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-900 transition hover:bg-neutral-200/70 dark:text-neutral-100 dark:hover:bg-neutral-800"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function ConversationRow({
  conversation,
  active,
  actions,
  onOpen,
  onDelete,
  onTogglePin,
}: {
  conversation: ConversationDTO
  active: boolean
  actions: boolean
  onOpen: (id: string) => void
  onDelete?: (id: string) => void
  onTogglePin?: (id: string, pinned: boolean) => void
}) {
  const pinned = Boolean(conversation.pinnedAt)
  return (
    <li data-conversation-id={conversation.id}>
      <div
        className={clsx(
          'group relative flex items-center rounded-lg px-2.5 py-1.5 text-[13px] transition',
          active
            ? 'bg-neutral-200 dark:bg-neutral-800'
            : 'hover:bg-neutral-200/70 dark:hover:bg-neutral-800',
        )}
      >
        <button
          type="button"
          onClick={() => onOpen(conversation.id)}
          className="min-w-0 flex-1 truncate text-left text-neutral-900 transition-[padding] group-hover:pr-14 group-focus-within:pr-14 dark:text-neutral-100"
          title={titleOf(conversation)}
        >
          {titleOf(conversation)}
        </button>
        {actions && (
          <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onTogglePin?.(conversation.id, !pinned)}
              className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              aria-label={pinned ? '取消置顶' : '置顶'}
              title={pinned ? '取消置顶' : '置顶'}
            >
              {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => onDelete?.(conversation.id)}
              className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
              aria-label="删除会话"
              title="删除会话"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

function ConversationSection({
  title,
  conversations,
  activeId,
  emptyText,
  collapsed,
  onToggleCollapsed,
  onOpen,
  onDelete,
  onTogglePin,
}: {
  title: string
  conversations: ConversationDTO[]
  activeId: string | undefined
  emptyText?: string
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
}) {
  return (
    <section className="pb-3.5">
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        className="group flex w-full items-center gap-1 px-2 pb-1.5 text-left text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"
      >
        <span>{title}</span>
        <ChevronDown
          className={clsx(
            'h-3.5 w-3.5 text-neutral-400 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100',
            collapsed && '-rotate-90',
          )}
        />
      </button>
      {!collapsed && conversations.length ? (
        <ul className="space-y-0.5">
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              actions
              onOpen={onOpen}
              onDelete={onDelete}
              onTogglePin={onTogglePin}
            />
          ))}
        </ul>
      ) : !collapsed && emptyText ? (
        <p className="px-2 py-1.5 text-[13px] text-neutral-400">{emptyText}</p>
      ) : null}
    </section>
  )
}

export function Sidebar() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: user } = useMe()
  const { data } = useConversations()
  const conversations = useMemo(() => data ?? [], [data])
  const logout = useLogout()
  const { collapsed, toggleCollapsed } = useSidebarStore()
  const { theme, setTheme } = useTheme()
  const [searchOpen, setSearchOpen] = useState(false)
  const [popover, setPopover] = useState<PopoverKind | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const [pinnedSectionCollapsed, setPinnedSectionCollapsed] = useState(false)
  const [recentSectionCollapsed, setRecentSectionCollapsed] = useState(false)

  const cycleTheme = () =>
    setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : RoutineIcon
  const userLabel = user?.displayName ?? user?.username ?? 'U'
  const isAdmin = user?.role === 'admin'

  const pinnedConversations = useMemo(
    () => conversations.filter((conversation) => conversation.pinnedAt),
    [conversations],
  )
  const recentConversations = useMemo(
    () => conversations.filter((conversation) => !conversation.pinnedAt),
    [conversations],
  )

  useEffect(() => {
    if (!popover) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[data-rail-trigger]')) return
      if (popoverRef.current?.contains(target)) return
      setPopover(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopover(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [popover])

  useEffect(() => {
    if (!accountMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[data-account-trigger]')) return
      if (accountMenuRef.current?.contains(target)) return
      setAccountMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [accountMenuOpen])

  const remove = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_r, deletedId) => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      if (deletedId === id) navigate('/')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  const pin = useMutation({
    mutationFn: ({ convId, pinned }: { convId: string; pinned: boolean }) =>
      pinConversation(convId, pinned),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation', updated.id] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '置顶失败'),
  })

  const openConversation = (conversationId: string) => {
    setPopover(null)
    setAccountMenuOpen(false)
    setSearchOpen(false)
    navigate(`/c/${conversationId}`)
  }

  const newChat = () => {
    setPopover(null)
    setAccountMenuOpen(false)
    setSearchOpen(false)
    navigate('/')
  }

  const deleteById = (conversationId: string) => {
    if (confirm('确定删除该会话？')) remove.mutate(conversationId)
  }

  const togglePin = (conversationId: string, pinned: boolean) => {
    pin.mutate({ convId: conversationId, pinned })
  }

  const popoverItems = popover === 'pinned' ? pinnedConversations : recentConversations

  return (
    <>
      <aside
        className={clsx(
          'relative flex h-full shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100',
          collapsed ? 'w-[48px]' : 'w-[240px]',
        )}
      >
        {collapsed ? (
          <>
            <div className="flex flex-1 flex-col items-center gap-2 py-2">
              <RailButton title="展开侧边栏" onClick={toggleCollapsed} testId="sidebar-toggle">
                <PanelLeft className="h-[18px] w-[18px]" />
              </RailButton>
              <div className="h-3" />
              <RailButton title="新聊天" onClick={newChat} testId="sidebar-new-chat">
                <NewChatIcon className="h-[18px] w-[18px]" />
              </RailButton>
              <RailButton title="搜索聊天" onClick={() => setSearchOpen(true)} testId="sidebar-search">
                <Search className="h-[17px] w-[17px]" strokeWidth={1.9} />
              </RailButton>
              <RailButton
                title="已置顶"
                active={popover === 'pinned'}
                onClick={() => setPopover((current) => (current === 'pinned' ? null : 'pinned'))}
                popoverTrigger
              >
                <Pin className="h-[18px] w-[18px]" />
              </RailButton>
              <RailButton
                title="最近聊天"
                active={popover === 'recent'}
                onClick={() => setPopover((current) => (current === 'recent' ? null : 'recent'))}
                popoverTrigger
              >
                <ChatBubbleIcon className="h-[18px] w-[18px]" />
              </RailButton>
            </div>
            <div className="flex flex-col items-center gap-1.5 py-2">
              <RailButton
                title={`主题：${theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}`}
                onClick={cycleTheme}
              >
                <ThemeIcon className="h-[18px] w-[18px]" />
              </RailButton>
              <button
                type="button"
                data-account-trigger
                onClick={() => {
                  setPopover(null)
                  setAccountMenuOpen((open) => !open)
                }}
                className="rounded-full transition hover:ring-4 hover:ring-neutral-200 dark:hover:ring-neutral-800"
                aria-label="账号菜单"
                title="账号菜单"
              >
                <Avatar label={userLabel} />
              </button>
            </div>

            {accountMenuOpen && (
              <div ref={accountMenuRef} className="absolute bottom-14 left-[42px] z-50 w-[240px]">
                <AccountMenu
                  userLabel={userLabel}
                  isAdmin={isAdmin}
                  onClose={() => setAccountMenuOpen(false)}
                  onLogout={() => {
                    setAccountMenuOpen(false)
                    logout.mutate()
                  }}
                />
              </div>
            )}

            {popover && (
              <div
                ref={popoverRef}
                className={clsx(
                  'absolute left-[42px] z-40 w-[312px] rounded-2xl border border-neutral-200 bg-white px-3 py-3.5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900',
                  popover === 'pinned' ? 'top-[136px]' : 'top-[178px]',
                )}
              >
                <h2 className="px-2 pb-2.5 text-[15px] font-semibold">
                  {popover === 'pinned' ? '已置顶' : '最近聊天'}
                </h2>
                {popoverItems.length ? (
                  <ul className="space-y-0.5">
                    {popoverItems.slice(0, 10).map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        active={conversation.id === id}
                        actions={false}
                        onOpen={openConversation}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 py-2.5 text-[13px] text-neutral-400">暂无聊天</p>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex h-14 items-center justify-between px-4">
              <h1 className="text-lg font-semibold tracking-normal">HappyChat</h1>
              <button
                type="button"
                onClick={toggleCollapsed}
                data-testid="sidebar-toggle"
                className="rounded-lg p-1.5 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                aria-label="收起侧边栏"
                title="收起侧边栏"
              >
                <PanelLeft className="h-[18px] w-[18px]" />
              </button>
            </div>

            <nav className="space-y-1 px-2.5 pb-4">
              <NavButton
                icon={<NewChatIcon className="h-[18px] w-[18px]" />}
                label="新聊天"
                onClick={newChat}
                testId="sidebar-new-chat"
              />
              <NavButton
                icon={<Search className="h-[17px] w-[17px]" strokeWidth={1.9} />}
                label="搜索聊天"
                onClick={() => setSearchOpen(true)}
                testId="sidebar-search"
              />
            </nav>

            <div className="hc-scrollbar flex-1 overflow-y-auto px-2">
              <ConversationSection
                title="已置顶"
                conversations={pinnedConversations}
                activeId={id}
                collapsed={pinnedSectionCollapsed}
                onToggleCollapsed={() => setPinnedSectionCollapsed((value) => !value)}
                onOpen={openConversation}
                onDelete={deleteById}
                onTogglePin={togglePin}
              />
              <ConversationSection
                title="聊天"
                conversations={recentConversations}
                activeId={id}
                emptyText="还没有会话"
                collapsed={recentSectionCollapsed}
                onToggleCollapsed={() => setRecentSectionCollapsed((value) => !value)}
                onOpen={openConversation}
                onDelete={deleteById}
                onTogglePin={togglePin}
              />
            </div>

            <div className="relative border-t border-neutral-200 px-2 py-2 dark:border-neutral-800">
              {accountMenuOpen && (
                <div ref={accountMenuRef} className="absolute bottom-[66px] left-2 right-2 z-50">
                  <AccountMenu
                    userLabel={userLabel}
                    isAdmin={isAdmin}
                    onClose={() => setAccountMenuOpen(false)}
                    onLogout={() => {
                      setAccountMenuOpen(false)
                      logout.mutate()
                    }}
                  />
                </div>
              )}

              <div className="group flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-neutral-200 dark:hover:bg-neutral-800">
                <button
                  type="button"
                  data-account-trigger
                  onClick={() => {
                    setPopover(null)
                    setAccountMenuOpen((open) => !open)
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-label="账号菜单"
                >
                  <Avatar label={userLabel} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-neutral-900 dark:text-neutral-100">
                      {userLabel}
                    </div>
                    <div className="truncate text-xs text-neutral-400">
                      {isAdmin ? '管理员' : 'Plus'}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={cycleTheme}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-neutral-700 transition group-hover:bg-neutral-300/70 hover:bg-neutral-300 hover:text-neutral-900 dark:text-neutral-300 dark:group-hover:bg-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                  title={`主题：${theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}`}
                  aria-label="切换主题"
                >
                  <ThemeIcon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </button>
              </div>
            </div>
          </>
        )}
      </aside>

      <SearchDialog
        open={searchOpen}
        conversations={conversations}
        onClose={() => setSearchOpen(false)}
        onNewChat={newChat}
        onOpenConversation={openConversation}
      />
    </>
  )
}
