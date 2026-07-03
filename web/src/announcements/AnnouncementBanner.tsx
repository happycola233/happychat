import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { useActiveAnnouncements, useMarkAnnouncementRead } from '../hooks/useAnnouncements'
import { LEVEL_META } from '../lib/announcementMeta'
import { useAnnouncementView } from '../store/announcementView'

/**
 * 聊天区顶部横幅：展示渠道为 banner 且未读的公告（关闭即标记已读）。
 * 通常只有 0–1 条；多条时纵向堆叠、置顶优先（顺序由后端保证）。
 */
export function AnnouncementBanner() {
  const { data } = useActiveAnnouncements()
  const markRead = useMarkAnnouncementRead()
  const openDetail = useAnnouncementView((s) => s.open)

  const banners = (data ?? []).filter((a) => a.channel === 'banner' && !a.read)
  if (banners.length === 0) return null

  return (
    <div className="shrink-0 space-y-2 px-2 pt-2 sm:px-4">
      {banners.map((a) => {
        const meta = LEVEL_META[a.level]
        const Icon = meta.icon
        return (
          <div
            key={a.id}
            className={clsx(
              'hc-anim-in flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm',
              meta.bannerClass,
            )}
          >
            <Icon className={clsx('h-4 w-4 shrink-0', meta.accentClass)} />
            <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
            <button
              type="button"
              onClick={() => {
                markRead.mutate(a.id)
                openDetail(a.id)
              }}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium underline-offset-2 transition hover:underline"
            >
              查看详情
            </button>
            <button
              type="button"
              onClick={() => markRead.mutate(a.id)}
              aria-label="关闭"
              className="shrink-0 rounded-md p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
