import { useEffect, useState } from 'react'
import { Bell, BellRing, CheckCheck, Inbox, Pin } from 'lucide-react'
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
      className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60"
    >
      {/* 级别图标放进同色浅底圆片（已读态不减淡：淡化会让整列图标发灰，已读区分交给标题字重与未读圆点） */}
      <span
        className={clsx(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          meta.softClass,
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={clsx(
              'min-w-0 flex-1 truncate text-sm',
              item.read
                ? 'text-neutral-700 dark:text-neutral-300'
                : 'font-medium text-neutral-900 dark:text-neutral-100',
            )}
          >
            {item.title}
          </span>
          {item.pinned && (
            <Pin className="h-3 w-3 shrink-0 rotate-45 text-neutral-300 dark:text-neutral-600" />
          )}
          <span className="shrink-0 text-[11px] text-neutral-400 tabular-nums dark:text-neutral-500">
            {formatAnnouncementTime(item.createdAt)}
          </span>
          {!item.read && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-label="未读" />
          )}
        </span>
        {preview && (
          <span
            className={clsx(
              'mt-0.5 line-clamp-2 text-xs leading-relaxed',
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
            className="hc-pop-in absolute right-0 top-full z-40 mt-2 flex max-h-[min(70vh,32rem)] w-[min(92vw,23rem)] flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-xl shadow-neutral-900/5 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/30"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  通知中心
                </span>
                {unread > 0 && (
                  <span className="rounded-full bg-red-50 px-1.5 py-px text-[11px] font-medium text-red-600 tabular-nums dark:bg-red-500/10 dark:text-red-400">
                    {unread} 条未读
                  </span>
                )}
              </div>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> 全部已读
                </button>
              )}
            </div>
            <div className="hc-scrollbar flex-1 overflow-y-auto p-1.5">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <Inbox className="h-5 w-5 text-neutral-400 dark:text-neutral-500" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                      暂无通知
                    </p>
                    <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                      新公告发布后会出现在这里
                    </p>
                  </div>
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
