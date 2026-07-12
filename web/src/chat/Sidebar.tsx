import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationDTO, FolderDTO } from '@shared/types/api'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  FolderInput,
  FolderPlus,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  MoreHorizontal,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ShareDialog } from './ShareDialog'
import { RowMenuItem } from './RowMenuItem'
import { FolderRow } from './FolderRow'
import { FolderMenuList } from './FolderMenuList'
import { buildSidebarSections, type FolderGroup } from './sidebarSections'
import { useConversations } from '../hooks/useConversations'
import { useConversationActions } from '../hooks/useConversationActions'
import { useFolderActions, useFolders } from '../hooks/useFolders'
import { useLogout, useMe } from '../hooks/useAuth'
import { useIsMobile, useSidebarStore } from '../store/sidebar'
import { useFolderEditor } from '../store/folderEditor'
import { useSettings } from '../store/settings'
import { useSettingsDialog } from '../store/settingsDialog'
import { useTitleTypingStore } from '../store/titleTyping'
import { HOVER_ACTION_PADDING_CLASS, HOVER_REVEAL_CLASS, useRowMenu } from './rowMenu'
import {
  ChatBubbleIcon,
  DeleteIcon,
  EditIcon,
  NewChatIcon,
  PinnedIcon,
  RoutineIcon,
  ShareIcon,
  SidebarToggleIcon,
  UnpinIcon,
} from './icons'
import { SearchDialog } from './SearchDialog'

type PopoverKind = 'pinned' | 'recent'

function titleOf(conversation: ConversationDTO): string {
  return conversation.title ?? '新聊天'
}

/** 会话行处理器集合：普通列表与文件夹内列表共用同一组回调。 */
interface ConversationRowHandlers {
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onRename: (id: string, title: string) => void
  onShare: (id: string) => void
  onMove: (id: string, folderId: string | null, folderName?: string) => void
  onMoveToNewFolder: (id: string) => void
}

/** 批量模式上下文：选中集合 + 切换回调；null 表示未进入批量模式。 */
interface BatchContext {
  selectedIds: ReadonlySet<string>
  onToggleSelect: (id: string) => void
}

function Avatar({ label, src }: { label: string; src?: string | null }) {
  if (src) {
    return (
      <img src={src} alt="头像" className="h-7 w-7 shrink-0 rounded-full object-cover shadow-sm" />
    )
  }
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
  onOpenSettings,
  onLogout,
}: {
  userLabel: string
  isAdmin: boolean
  onClose: () => void
  onOpenSettings: () => void
  onLogout: () => void
}) {
  // 触发按钮上已有头像与昵称，菜单里不再重复展示大头像——
  // 顶部只保留一行小字身份行（ChatGPT 式），图标紧贴文字，所有内容左对齐同一条线（px-3）。
  const itemClass =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
  const itemIconClass = 'h-[18px] w-[18px] shrink-0 text-neutral-500 dark:text-neutral-400'
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="truncate px-3 pb-1.5 pt-2 text-xs text-neutral-400 dark:text-neutral-500">
        {userLabel} · {isAdmin ? '管理员' : 'Plus'}
      </div>

      <div className="mx-1 border-t border-neutral-100 dark:border-neutral-800" />

      <div className="space-y-0.5 py-1">
        <button type="button" onClick={onOpenSettings} className={itemClass}>
          <Settings className={itemIconClass} />
          设置
        </button>
        {isAdmin && (
          <Link to="/admin" onClick={onClose} className={itemClass}>
            <LayoutDashboard className={itemIconClass} />
            管理后台
          </Link>
        )}
        {/* 退出与常规入口同构，仅悬停转红提示破坏性。 */}
        <button
          type="button"
          onClick={onLogout}
          className={clsx(
            itemClass,
            'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 [&:hover>svg]:text-red-600 dark:[&:hover>svg]:text-red-400',
          )}
        >
          <LogOut className={itemIconClass} />
          退出登录
        </button>
      </div>
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
        'group relative flex h-8 w-8 items-center justify-center rounded-lg text-neutral-900 transition dark:text-neutral-100',
        active
          ? 'bg-neutral-200 dark:bg-neutral-800'
          : 'hover:bg-neutral-200/70 dark:hover:bg-neutral-800',
      )}
    >
      {children}
      <span
        className={clsx(
          'pointer-events-none absolute left-full top-1/2 z-50 ml-2.5 -translate-y-1/2 whitespace-nowrap rounded-lg bg-black px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-lg transition group-hover:opacity-100',
          active && 'hidden',
        )}
      >
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

/** 批量模式的圆形选择标记。 */
function SelectDot({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'mr-2 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition',
        checked
          ? 'border-sky-500 bg-sky-500 text-white'
          : 'border-neutral-300 bg-white text-transparent dark:border-neutral-600 dark:bg-neutral-900',
      )}
    >
      <Check className="h-3 w-3" strokeWidth={3} />
    </span>
  )
}

function ConversationRow({
  conversation,
  active,
  actions,
  folders,
  batch,
  onOpen,
  onDelete,
  onTogglePin,
  onRename,
  onShare,
  onMove,
  onMoveToNewFolder,
}: {
  conversation: ConversationDTO
  active: boolean
  actions: boolean
  /** 「移动到文件夹」的目标列表；未提供时菜单不含该项（如折叠栏 popover） */
  folders?: FolderDTO[]
  /** 批量模式：提供后行点击 = 切换选中，隐藏行内菜单 */
  batch?: { selected: boolean; onToggleSelect: (id: string) => void } | null
  onOpen: (id: string) => void
  onDelete?: (id: string) => void
  onTogglePin?: (id: string, pinned: boolean) => void
  onRename?: (id: string, title: string) => void
  onShare?: (id: string) => void
  onMove?: (id: string, folderId: string | null, folderName?: string) => void
  onMoveToNewFolder?: (id: string) => void
}) {
  const pinned = Boolean(conversation.pinnedAt)
  const [menuView, setMenuView] = useState<'root' | 'move'>('root')
  // 菜单切换到「移动」视图会改变高度，remeasureKey 触发重估上下翻转方向。
  const { menuOpen, setMenuOpen, menuPlacement, menuRef, rowRef, toggleMenu } = useRowMenu(menuView)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const typingTitle = useTitleTypingStore((state) => state.byConversation[conversation.id])
  const displayTitle = typingTitle?.text ?? titleOf(conversation)

  const startRename = () => {
    setDraft(titleOf(conversation))
    setRenaming(true)
    setMenuOpen(false)
  }
  const submitRename = () => {
    const t = draft.trim()
    if (t && t !== titleOf(conversation)) onRename?.(conversation.id, t)
    setRenaming(false)
  }

  // 批量模式：整行变成选择开关，不导航、不弹菜单。
  if (batch) {
    return (
      <li data-conversation-id={conversation.id}>
        <button
          type="button"
          onClick={() => batch.onToggleSelect(conversation.id)}
          aria-pressed={batch.selected}
          title={titleOf(conversation)}
          className={clsx(
            'flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] transition',
            batch.selected
              ? 'bg-sky-100/70 dark:bg-sky-950/50'
              : 'hover:bg-neutral-200/70 dark:hover:bg-neutral-800',
          )}
        >
          <SelectDot checked={batch.selected} />
          <span className="min-w-0 flex-1 truncate text-neutral-900 dark:text-neutral-100">
            {displayTitle}
          </span>
        </button>
      </li>
    )
  }

  const showMove = Boolean(folders && onMove)

  return (
    <li data-conversation-id={conversation.id}>
      <div
        ref={rowRef}
        className={clsx(
          'group relative flex items-center rounded-lg px-2.5 py-1.5 text-[13px] transition',
          active
            ? 'bg-neutral-200 dark:bg-neutral-800'
            : 'hover:bg-neutral-200/70 dark:hover:bg-neutral-800',
          menuOpen && 'bg-neutral-200/70 dark:bg-neutral-800',
        )}
      >
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitRename()
              } else if (e.key === 'Escape') {
                setRenaming(false)
              }
            }}
            className="min-w-0 flex-1 rounded-md bg-white px-1.5 py-0.5 text-[13px] text-neutral-900 outline-none ring-1 ring-neutral-400 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-neutral-600"
          />
        ) : (
          <button
            type="button"
            onClick={() => onOpen(conversation.id)}
            className={clsx(
              'min-w-0 flex-1 text-left text-neutral-900 transition-[padding] dark:text-neutral-100',
              actions && HOVER_ACTION_PADDING_CLASS,
            )}
            title={titleOf(conversation)}
          >
            <span className="flex min-w-0 items-center">
              <span className="truncate">{displayTitle}</span>
              {typingTitle?.active && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-3.5 w-px shrink-0 animate-pulse bg-neutral-500 dark:bg-neutral-300"
                />
              )}
            </span>
          </button>
        )}
        {actions && !renaming && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setMenuView('root')
              toggleMenu()
            }}
            className={clsx(
              'absolute right-1 rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-700 dark:hover:text-neutral-100',
              menuOpen ? 'opacity-100' : HOVER_REVEAL_CLASS,
            )}
            aria-label="更多操作"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
        {menuOpen && (
          <div
            ref={menuRef}
            className={clsx(
              'hc-pop-in absolute right-0 z-40 rounded-xl border border-neutral-200 bg-white p-1 text-[13px] shadow-2xl dark:border-neutral-700 dark:bg-neutral-900',
              menuView === 'move' ? 'w-52' : 'w-40',
              menuPlacement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
            )}
          >
            {menuView === 'root' ? (
              <>
                <RowMenuItem
                  icon={<ShareIcon className="h-4 w-4" />}
                  onClick={() => {
                    setMenuOpen(false)
                    onShare?.(conversation.id)
                  }}
                >
                  分享
                </RowMenuItem>
                <RowMenuItem icon={<EditIcon className="h-4 w-4" />} onClick={startRename}>
                  重命名
                </RowMenuItem>
                <RowMenuItem
                  icon={
                    pinned ? <UnpinIcon className="h-4 w-4" /> : <PinnedIcon className="h-4 w-4" />
                  }
                  onClick={() => {
                    setMenuOpen(false)
                    onTogglePin?.(conversation.id, !pinned)
                  }}
                >
                  {pinned ? '取消置顶' : '置顶'}
                </RowMenuItem>
                {showMove && (
                  <RowMenuItem
                    // 菜单里其余图标是 fill 风格自绘图标：lucide 描边图标压细笔画、
                    // 缩小一号（!important 盖过 RowMenuItem 的 [&>svg]:h-4）对齐视觉重量
                    icon={<FolderInput className="!h-[15px] !w-[15px]" strokeWidth={1.6} />}
                    onClick={() => setMenuView('move')}
                  >
                    移动到文件夹
                  </RowMenuItem>
                )}
                <RowMenuItem
                  icon={<DeleteIcon className="h-4 w-4" />}
                  danger
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete?.(conversation.id)
                  }}
                >
                  删除
                </RowMenuItem>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1 px-1 pb-1 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setMenuView('root')}
                    aria-label="返回"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    移动到文件夹
                  </span>
                </div>
                <FolderMenuList
                  folders={folders ?? []}
                  currentFolderId={conversation.folderId}
                  showRemove={Boolean(conversation.folderId)}
                  onSelect={(folderId) => {
                    setMenuOpen(false)
                    if (folderId === conversation.folderId) return
                    onMove?.(
                      conversation.id,
                      folderId,
                      folders?.find((f) => f.id === folderId)?.name,
                    )
                  }}
                  onCreateNew={() => {
                    setMenuOpen(false)
                    onMoveToNewFolder?.(conversation.id)
                  }}
                />
              </>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/** 分区标题右侧的小图标按钮（批量管理/新建文件夹）。 */
function SectionActionButton({
  title,
  active,
  onClick,
  testId,
  children,
}: {
  title: string
  active?: boolean
  onClick: () => void
  testId?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className={clsx(
        'flex h-6 w-6 items-center justify-center rounded-md transition',
        active
          ? 'bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100'
          : 'text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
      )}
    >
      {children}
    </button>
  )
}

function SidebarSection({
  title,
  collapsed,
  onToggleCollapsed,
  actions,
  children,
}: {
  title: string
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 标题右侧的操作按钮 */
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section className="pb-3.5">
      <div className="group flex items-center gap-1 pb-1.5 pl-2.5 pr-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-[13px] font-semibold text-neutral-900 dark:text-neutral-100"
        >
          <span className="truncate">{title}</span>
          <ChevronDown
            className={clsx(
              'h-3.5 w-3.5 shrink-0 text-neutral-400 transition',
              HOVER_REVEAL_CLASS,
              collapsed && '-rotate-90',
            )}
          />
        </button>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {!collapsed && children}
    </section>
  )
}

/** 文件夹操作集合（编辑/置顶/删除），由 Sidebar 统一注入。 */
interface FolderHandlers {
  onEdit: (folder: FolderDTO) => void
  onTogglePin: (folderId: string, pinned: boolean) => void
  onDelete: (folder: FolderDTO, memberCount: number) => void
}

/** 文件夹行 + 展开的成员列表。 */
function FolderBlock({
  group,
  activeId,
  expanded,
  onToggleExpand,
  batch,
  folders,
  rowHandlers,
  folderHandlers,
}: {
  group: FolderGroup
  activeId: string | undefined
  expanded: boolean
  onToggleExpand: () => void
  batch: BatchContext | null
  folders: FolderDTO[]
  rowHandlers: ConversationRowHandlers
  folderHandlers: FolderHandlers
}) {
  const { folder, conversations: members } = group
  const containsActive = Boolean(activeId && members.some((c) => c.id === activeId))
  return (
    <FolderRow
      folder={folder}
      count={members.length}
      expanded={expanded}
      containsActive={containsActive}
      batchMode={Boolean(batch)}
      onToggleExpand={onToggleExpand}
      onEdit={() => folderHandlers.onEdit(folder)}
      onTogglePin={(pinned) => folderHandlers.onTogglePin(folder.id, pinned)}
      onDelete={() => folderHandlers.onDelete(folder, members.length)}
    >
      {expanded &&
        (members.length ? (
          // 缩进 + 引导线：线对齐文件夹图标芯片的竖直中线（px-2.5 + 芯片半宽）。
          <ul className="ml-[22px] mt-0.5 space-y-0.5 border-l border-neutral-200 pl-1.5 dark:border-neutral-800">
            {members.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                actions
                folders={folders}
                batch={
                  batch
                    ? {
                        selected: batch.selectedIds.has(conversation.id),
                        onToggleSelect: batch.onToggleSelect,
                      }
                    : null
                }
                {...rowHandlers}
              />
            ))}
          </ul>
        ) : (
          <p className="ml-[22px] border-l border-neutral-200 py-1.5 pl-3 text-xs text-neutral-400 dark:border-neutral-800">
            文件夹是空的
          </p>
        ))}
    </FolderRow>
  )
}

export function Sidebar() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: user } = useMe()
  const { data } = useConversations()
  const conversations = useMemo(() => data ?? [], [data])
  const { data: folderData } = useFolders()
  const folders = useMemo(() => folderData ?? [], [folderData])
  const logout = useLogout()
  const { collapsed, toggleCollapsed } = useSidebarStore()
  const pinnedSectionCollapsed = useSidebarStore((s) => s.pinnedSectionCollapsed)
  const recentSectionCollapsed = useSidebarStore((s) => s.recentSectionCollapsed)
  const togglePinnedSectionCollapsed = useSidebarStore((s) => s.togglePinnedSectionCollapsed)
  const toggleRecentSectionCollapsed = useSidebarStore((s) => s.toggleRecentSectionCollapsed)
  const expandedFolders = useSidebarStore((s) => s.expandedFolders)
  const toggleFolderExpanded = useSidebarStore((s) => s.toggleFolderExpanded)
  const expandFolder = useSidebarStore((s) => s.expandFolder)
  const mobileOpen = useSidebarStore((s) => s.mobileOpen)
  const setMobileOpen = useSidebarStore((s) => s.setMobileOpen)
  const isMobile = useIsMobile()
  const railMode = collapsed && !isMobile
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const openSettingsDialog = useSettingsDialog((s) => s.openDialog)
  const openFolderEditorCreate = useFolderEditor((s) => s.openCreate)
  const openFolderEditorEdit = useFolderEditor((s) => s.openEdit)
  const [searchOpen, setSearchOpen] = useState(false)
  const [popover, setPopover] = useState<PopoverKind | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const [shareTarget, setShareTarget] = useState<string | null>(null)

  // 批量管理：选中集合仅存在于本次进入期间，退出即清空。
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [movePickerOpen, setMovePickerOpen] = useState(false)
  const movePickerRef = useRef<HTMLDivElement>(null)

  const cycleTheme = () =>
    setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : RoutineIcon
  const userLabel = user?.displayName ?? user?.username ?? 'U'
  const isAdmin = user?.role === 'admin'

  const sections = useMemo(
    () => buildSidebarSections(folders, conversations),
    [folders, conversations],
  )
  const unpinnedConversations = useMemo(
    () => conversations.filter((conversation) => !conversation.pinnedAt),
    [conversations],
  )

  // 打开文件夹内的会话时自动展开所在文件夹（如从搜索进入），便于在列表中定位。
  const activeFolderId = conversations.find((c) => c.id === id)?.folderId ?? null
  useEffect(() => {
    if (activeFolderId) expandFolder(activeFolderId)
  }, [activeFolderId, expandFolder])

  // 折叠为 rail 时批量模式没有承载界面，直接退出。
  useEffect(() => {
    if (railMode && batchMode) {
      setBatchMode(false)
      setSelectedIds(new Set())
      setMovePickerOpen(false)
    }
  }, [railMode, batchMode])

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

  useEffect(() => {
    if (!movePickerOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (movePickerRef.current?.contains(target)) return
      setMovePickerOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMovePickerOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [movePickerOpen])

  const { deleteWithConfirm, batchDeleteWithConfirm, moveToFolder, togglePin, renameTo } =
    useConversationActions()
  const folderActions = useFolderActions()

  const openConversation = (conversationId: string) => {
    setPopover(null)
    setAccountMenuOpen(false)
    setSearchOpen(false)
    setMobileOpen(false)
    navigate(`/c/${conversationId}`)
  }

  const newChat = () => {
    setPopover(null)
    setAccountMenuOpen(false)
    setSearchOpen(false)
    setMobileOpen(false)
    navigate('/')
  }

  const openSettings = () => {
    setAccountMenuOpen(false)
    setMobileOpen(false)
    openSettingsDialog()
  }

  // ---------- 批量管理 ----------
  const exitBatchMode = () => {
    setBatchMode(false)
    setSelectedIds(new Set())
    setMovePickerOpen(false)
  }
  const toggleSelected = (conversationId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(conversationId)) next.delete(conversationId)
      else next.add(conversationId)
      return next
    })
  }
  const allSelected = conversations.length > 0 && selectedIds.size === conversations.length
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(conversations.map((c) => c.id)))
  }
  const selectedList = useMemo(() => [...selectedIds], [selectedIds])

  const batch: BatchContext | null = batchMode
    ? { selectedIds, onToggleSelect: toggleSelected }
    : null

  // ---------- 会话/文件夹行的回调 ----------
  const rowHandlers: ConversationRowHandlers = {
    onOpen: openConversation,
    onDelete: deleteWithConfirm,
    onTogglePin: togglePin,
    onRename: renameTo,
    onShare: setShareTarget,
    onMove: (conversationId, folderId, folderName) =>
      moveToFolder([conversationId], folderId, folderName),
    onMoveToNewFolder: (conversationId) =>
      openFolderEditorCreate((folder) => moveToFolder([conversationId], folder.id, folder.name)),
  }

  const folderHandlers: FolderHandlers = {
    onEdit: openFolderEditorEdit,
    onTogglePin: folderActions.togglePin,
    onDelete: folderActions.deleteWithConfirm,
  }

  const renderFolderBlock = (group: FolderGroup) => (
    <FolderBlock
      key={group.folder.id}
      group={group}
      activeId={id}
      expanded={Boolean(expandedFolders[group.folder.id])}
      onToggleExpand={() => toggleFolderExpanded(group.folder.id)}
      batch={batch}
      folders={folders}
      rowHandlers={rowHandlers}
      folderHandlers={folderHandlers}
    />
  )

  const renderConversationRow = (conversation: ConversationDTO) => (
    <ConversationRow
      key={conversation.id}
      conversation={conversation}
      active={conversation.id === id}
      actions
      folders={folders}
      batch={
        batch
          ? {
              selected: batch.selectedIds.has(conversation.id),
              onToggleSelect: batch.onToggleSelect,
            }
          : null
      }
      {...rowHandlers}
    />
  )

  const popoverItems = popover === 'pinned' ? sections.pinnedConversations : unpinnedConversations

  return (
    <>
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={clsx(
          'flex h-full shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100',
          // 桌面：文档流中的 rail
          'md:relative md:translate-x-0 md:shadow-none md:transition-[width,background-color,border-color] md:duration-300 md:ease-[cubic-bezier(0.22,1,0.36,1)]',
          railMode ? 'md:w-[48px]' : 'md:w-[240px]',
          railMode ? 'md:overflow-visible' : 'overflow-hidden',
          // 移动：固定抽屉，按 mobileOpen 滑入/滑出
          'fixed inset-y-0 left-0 z-50 w-[280px] transition-transform duration-300',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
        {railMode ? (
          <>
            <div className="hc-sidebar-rail-in flex min-w-[48px] flex-1 flex-col">
              <div className="flex h-14 items-center justify-center">
                <RailButton title="展开侧边栏" onClick={toggleCollapsed} testId="sidebar-toggle">
                  <SidebarToggleIcon className="h-5 w-5" />
                </RailButton>
              </div>
              <nav className="flex flex-col items-center gap-1 px-2 pb-4">
                <RailButton title="新聊天" onClick={newChat} testId="sidebar-new-chat">
                  <NewChatIcon className="h-[18px] w-[18px]" />
                </RailButton>
                <RailButton
                  title="搜索聊天"
                  onClick={() => setSearchOpen(true)}
                  testId="sidebar-search"
                >
                  <Search className="h-[17px] w-[17px]" strokeWidth={1.9} />
                </RailButton>
                <RailButton
                  title="已置顶"
                  active={popover === 'pinned'}
                  onClick={() => setPopover((current) => (current === 'pinned' ? null : 'pinned'))}
                  popoverTrigger
                >
                  <PinnedIcon className="h-[18px] w-[18px]" />
                </RailButton>
                <RailButton
                  title="最近聊天"
                  active={popover === 'recent'}
                  onClick={() => setPopover((current) => (current === 'recent' ? null : 'recent'))}
                  popoverTrigger
                >
                  <ChatBubbleIcon className="h-[18px] w-[18px]" />
                </RailButton>
              </nav>
            </div>
            <div className="flex flex-col items-center gap-2.5 pb-2 pt-1">
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
                <Avatar label={userLabel} src={user?.avatarUrl} />
              </button>
            </div>

            {accountMenuOpen && (
              // 底边与头像按钮下缘对齐（头像区 pb-2），避免菜单悬在半空显得「偏上」。
              <div ref={accountMenuRef} className="absolute bottom-2 left-[42px] z-50 w-[240px]">
                <AccountMenu
                  userLabel={userLabel}
                  isAdmin={isAdmin}
                  onClose={() => setAccountMenuOpen(false)}
                  onOpenSettings={openSettings}
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
                  popover === 'pinned' ? 'top-[122px]' : 'top-[158px]',
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
          <div className="hc-sidebar-panel-in flex h-full min-w-[240px] flex-col">
            <div className="flex h-14 items-center justify-between px-4">
              <h1 className="text-lg font-semibold tracking-normal">HappyChat</h1>
              <button
                type="button"
                onClick={() => (isMobile ? setMobileOpen(false) : toggleCollapsed())}
                data-testid="sidebar-toggle"
                className="rounded-lg p-1.5 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                aria-label={isMobile ? '关闭侧边栏' : '收起侧边栏'}
                title={isMobile ? '关闭侧边栏' : '收起侧边栏'}
              >
                <SidebarToggleIcon className="h-5 w-5" />
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
              <SidebarSection
                title="已置顶"
                collapsed={pinnedSectionCollapsed}
                onToggleCollapsed={togglePinnedSectionCollapsed}
              >
                {sections.pinnedFolders.length || sections.pinnedConversations.length ? (
                  <ul className="space-y-0.5">
                    {sections.pinnedFolders.map(renderFolderBlock)}
                    {sections.pinnedConversations.map(renderConversationRow)}
                  </ul>
                ) : null}
              </SidebarSection>
              <SidebarSection
                title="聊天"
                collapsed={recentSectionCollapsed}
                onToggleCollapsed={toggleRecentSectionCollapsed}
                actions={
                  <>
                    <SectionActionButton
                      title={batchMode ? '退出批量管理' : '批量管理'}
                      active={batchMode}
                      testId="sidebar-batch-manage"
                      onClick={() => (batchMode ? exitBatchMode() : setBatchMode(true))}
                    >
                      <ListChecks className="h-[15px] w-[15px]" strokeWidth={1.8} />
                    </SectionActionButton>
                    <SectionActionButton
                      title="新建文件夹"
                      testId="sidebar-new-folder"
                      onClick={() => openFolderEditorCreate()}
                    >
                      <FolderPlus className="h-[15px] w-[15px]" strokeWidth={1.8} />
                    </SectionActionButton>
                  </>
                }
              >
                {sections.folders.length || sections.looseConversations.length ? (
                  <ul className="space-y-0.5">
                    {sections.folders.map(renderFolderBlock)}
                    {sections.looseConversations.map(renderConversationRow)}
                  </ul>
                ) : (
                  <p className="px-2.5 py-1.5 text-[13px] text-neutral-400">还没有会话</p>
                )}
              </SidebarSection>
            </div>

            {/* 批量管理工具栏：仅批量模式显示，覆盖在账号区上方 */}
            {batchMode && (
              <div
                className="hc-pop-in border-t border-neutral-200 px-3 pb-2.5 pt-2 dark:border-neutral-800"
                data-testid="batch-toolbar"
              >
                <div className="flex items-center justify-between pb-2">
                  <span
                    className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100"
                    data-testid="batch-selected-count"
                  >
                    已选 {selectedIds.size} 个聊天
                  </span>
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="rounded-md px-1.5 py-0.5 text-xs text-neutral-500 transition hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  >
                    {allSelected ? '取消全选' : '全选'}
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <div ref={movePickerRef} className="relative flex-1">
                    <button
                      type="button"
                      disabled={selectedIds.size === 0}
                      data-testid="batch-move"
                      onClick={() => setMovePickerOpen((open) => !open)}
                      className="w-full rounded-lg bg-neutral-200/70 px-2 py-1.5 text-[13px] font-medium text-neutral-800 transition hover:bg-neutral-200 disabled:opacity-40 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
                    >
                      移动
                    </button>
                    {movePickerOpen && (
                      <div className="hc-pop-in absolute bottom-full left-0 z-50 mb-1.5 w-56 rounded-xl border border-neutral-200 bg-white p-1 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
                        <FolderMenuList
                          folders={folders}
                          showRemove
                          onSelect={(folderId) => {
                            setMovePickerOpen(false)
                            moveToFolder(
                              selectedList,
                              folderId,
                              folders.find((f) => f.id === folderId)?.name,
                              exitBatchMode,
                            )
                          }}
                          onCreateNew={() => {
                            setMovePickerOpen(false)
                            const ids = selectedList
                            openFolderEditorCreate((folder) =>
                              moveToFolder(ids, folder.id, folder.name, exitBatchMode),
                            )
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={selectedIds.size === 0}
                    data-testid="batch-delete"
                    onClick={() => batchDeleteWithConfirm(selectedList, exitBatchMode)}
                    className="flex-1 rounded-lg bg-red-50 px-2 py-1.5 text-[13px] font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-40 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/60"
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    data-testid="batch-done"
                    onClick={exitBatchMode}
                    className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                  >
                    完成
                  </button>
                </div>
              </div>
            )}

            <div className="relative border-t border-neutral-200 px-2 py-2 dark:border-neutral-800">
              {accountMenuOpen && (
                <div ref={accountMenuRef} className="absolute bottom-[66px] left-2 right-2 z-50">
                  <AccountMenu
                    userLabel={userLabel}
                    isAdmin={isAdmin}
                    onClose={() => setAccountMenuOpen(false)}
                    onOpenSettings={openSettings}
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
                  <Avatar label={userLabel} src={user?.avatarUrl} />
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
          </div>
        )}
      </aside>

      <SearchDialog
        open={searchOpen}
        conversations={conversations}
        onClose={() => setSearchOpen(false)}
        onNewChat={newChat}
        onOpenConversation={openConversation}
      />

      {shareTarget && (
        <ShareDialog conversationId={shareTarget} onClose={() => setShareTarget(null)} />
      )}
    </>
  )
}
