import { useEffect, useRef, useState } from 'react'
import { Bell, BellRing, CheckCheck, ChevronRight, Inbox, Pin, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { UserAnnouncementDTO } from '@shared/types/api'
import {
  useActiveAnnouncements,
  useMarkAllAnnouncementsRead,
  useMarkAnnouncementRead,
} from '../hooks/useAnnouncements'
import { formatAnnouncementTime, LEVEL_META } from '../lib/announcementMeta'
import { useAnnouncementView } from '../store/announcementView'
import { IconButton } from '../components/ui/IconButton'
import { Button } from '../components/ui/Button'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { LoadError } from '../components/ui/LoadError'

/** 从 Markdown 正文提取一行纯文本预览（去掉常见标记符号）。 */
function plainPreview(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保留文字
    .replace(/[#>*_`~-]/g, ' ') // 标记符号
    .replace(/\s+/g, ' ')
    .trim()
}

function AnnouncementRow({
  item,
  onOpen,
}: {
  item: UserAnnouncementDTO
  onOpen: (item: UserAnnouncementDTO) => void
}) {
  const meta = LEVEL_META[item.level]
  const Icon = meta.icon
  const preview = plainPreview(item.body)
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group flex w-full items-start gap-3 rounded-xl px-4 py-4 text-left transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 dark:hover:bg-neutral-800/50"
    >
      <span className="min-w-0 flex-1">
        <span className="mb-2 flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className={clsx('inline-flex items-center gap-1', meta.accentClass)}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {meta.label}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatAnnouncementTime(item.publishAt ?? item.createdAt)}</span>
          {item.pinned && <Pin className="h-3 w-3" aria-label="置顶" />}
          {!item.read && (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sky-500" aria-label="未读" />
          )}
        </span>
        <span className="flex items-start gap-2">
          <span
            className={clsx(
              'min-w-0 flex-1 line-clamp-2 text-sm leading-6',
              item.read
                ? 'font-medium text-neutral-600 dark:text-neutral-300'
                : 'font-semibold text-neutral-900 dark:text-neutral-100',
            )}
          >
            {item.title}
          </span>
          <ChevronRight
            className="mt-1 h-4 w-4 shrink-0 text-neutral-300 transition group-hover:text-neutral-500 dark:text-neutral-600"
            aria-hidden="true"
          />
        </span>
        {preview && (
          <span
            className={clsx(
              'mt-1.5 line-clamp-2 text-xs leading-5',
              item.read
                ? 'text-neutral-400 dark:text-neutral-500'
                : 'text-neutral-500 dark:text-neutral-400',
            )}
          >
            {preview}
          </span>
        )}
      </span>
    </button>
  )
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const panelRef = useRef<HTMLDivElement>(null)
  const { data, isPending, isError, refetch } = useActiveAnnouncements()
  const markRead = useMarkAnnouncementRead()
  const markAll = useMarkAllAnnouncementsRead()
  const openDetail = useAnnouncementView((s) => s.open)

  const items = data ?? []
  const unread = items.filter((a) => !a.read).length
  const markableUnread = items.some((item) => !item.read && item.channel !== 'modal')
  const visibleItems = filter === 'unread' ? items.filter((item) => !item.read) : items

  // Esc 关闭下拉
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement as HTMLElement | null
    panelRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [open])

  const onOpenItem = (item: UserAnnouncementDTO) => {
    // 未确认强提示必须在详情里的「我知道了」按钮完成确认，不能靠点开条目绕过。
    if (!item.read && item.channel !== 'modal') markRead.mutate(item.id)
    openDetail(item.id)
    setOpen(false)
  }

  return (
    <div className="relative">
      <IconButton
        variant="toolbar"
        label={unread > 0 ? `通知中心，${unread} 条未读` : '通知中心'}
        onClick={() => {
          setFilter('all')
          setOpen((v) => !v)
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {unread > 0 ? <BellRing strokeWidth={1.75} /> : <Bell strokeWidth={1.75} />}
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </IconButton>

      {open && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="通知中心"
            tabIndex={-1}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget)
              )
                setOpen(false)
            }}
            className="hc-pop-in fixed inset-x-3 top-16 z-40 flex max-h-[min(75dvh,38rem)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white outline-none sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-3 sm:w-[25rem] dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="shrink-0 px-5 pt-4 pb-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  通知中心
                </span>
                <IconButton label="关闭通知中心" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SegmentedControl
                  label="通知筛选"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'unread', label: '未读', count: unread },
                  ]}
                />
                {markableUnread && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={markAll.isPending}
                    onClick={() => markAll.mutate()}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    全部已读
                  </Button>
                )}
              </div>
            </div>
            <div className="hc-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
              {isPending ? (
                <p className="px-5 py-12 text-center text-sm text-neutral-500">正在加载通知…</p>
              ) : isError ? (
                <LoadError onRetry={() => void refetch()} />
              ) : visibleItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <Inbox
                    className="h-6 w-6 text-neutral-300 dark:text-neutral-600"
                    strokeWidth={1.5}
                  />
                  <p className="mt-3 text-sm font-medium text-neutral-500 dark:text-neutral-400">
                    {filter === 'unread' ? '所有通知都已读完' : '暂无通知'}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                    {filter === 'unread'
                      ? '可在「全部」中回看之前的公告'
                      : '新公告发布后会出现在这里'}
                  </p>
                </div>
              ) : (
                visibleItems.map((item) => (
                  <AnnouncementRow key={item.id} item={item} onOpen={onOpenItem} />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
