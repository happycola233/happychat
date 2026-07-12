import { useEffect, useState } from 'react'
import { Bell, BellRing, CheckCheck } from 'lucide-react'
import { clsx } from 'clsx'
import type { UserAnnouncementDTO } from '@shared/types/api'
import {
  useActiveAnnouncements,
  useMarkAllAnnouncementsRead,
  useMarkAnnouncementRead,
} from '../hooks/useAnnouncements'
import { formatAnnouncementTime, LEVEL_META } from '../lib/announcementMeta'
import { useAnnouncementView } from '../store/announcementView'

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
      className={clsx(
        'flex w-full gap-2.5 border-b border-neutral-100 px-4 py-3 text-left transition last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50',
        !item.read && 'bg-neutral-50/60 dark:bg-neutral-800/30',
      )}
    >
      {/* 级别图标 + 未读红点叠在右上角（无需单独占位列） */}
      <span className="relative mt-0.5 shrink-0">
        <Icon className={clsx('h-4 w-4', meta.accentClass)} />
        {!item.read && (
          <span
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-neutral-900"
            aria-label="未读"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={clsx(
              'truncate text-sm',
              item.read
                ? 'text-neutral-600 dark:text-neutral-400'
                : 'font-medium text-neutral-900 dark:text-neutral-100',
            )}
          >
            {item.title}
          </span>
          <span className="shrink-0 text-xs text-neutral-400">
            {formatAnnouncementTime(item.createdAt)}
          </span>
        </div>
        {preview && (
          <p className="mt-0.5 truncate text-xs text-neutral-400">{preview}</p>
        )}
      </div>
    </button>
  )
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { data } = useActiveAnnouncements()
  const markRead = useMarkAnnouncementRead()
  const markAll = useMarkAllAnnouncementsRead()
  const openDetail = useAnnouncementView((s) => s.open)

  const items = data ?? []
  const unread = items.filter((a) => !a.read).length

  // Esc 关闭下拉
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onOpenItem = (item: UserAnnouncementDTO) => {
    if (!item.read) markRead.mutate(item.id)
    openDetail(item.id)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        aria-label={unread > 0 ? `通知中心，${unread} 条未读` : '通知中心'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* 铃铛轮廓视觉体量偏大，特意使用 18px，使其与右侧 20px 三点图标在视觉上保持一致。 */}
        {unread > 0 ? (
          <BellRing className="h-[18px] w-[18px]" />
        ) : (
          <Bell className="h-[18px] w-[18px]" />
        )}
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="通知中心"
            className="hc-pop-in absolute right-0 top-full z-40 mt-2 flex max-h-[70vh] w-[min(92vw,22rem)] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                通知中心
              </span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> 全部已读
                </button>
              )}
            </div>
            <div className="hc-scrollbar flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                  <Bell className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
                  <p className="text-sm text-neutral-400">暂无通知</p>
                </div>
              ) : (
                items.map((item) => (
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
