import { ArrowUpRight, X } from 'lucide-react'
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
    <div className="shrink-0 space-y-2 px-3 pt-3 sm:px-5">
      {banners.map((a) => {
        const meta = LEVEL_META[a.level]
        const Icon = meta.icon
        return (
          <div
            key={a.id}
            className={clsx(
              'hc-anim-in mx-auto flex max-w-5xl items-center gap-1 rounded-xl pr-2 text-sm',
              meta.bannerClass,
            )}
          >
            <button
              type="button"
              onClick={() => {
                markRead.mutate(a.id)
                openDetail(a.id)
              }}
              className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current dark:hover:bg-white/5"
            >
              <Icon className={clsx('h-4 w-4 shrink-0', meta.accentClass)} aria-hidden="true" />
              <span className="min-w-0 flex-1 line-clamp-2 text-[13px] leading-5 font-medium">
                {a.title}
              </span>
              <span className="hidden shrink-0 text-xs sm:inline">查看详情</span>
              <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => markRead.mutate(a.id)}
              aria-label={`关闭公告 ${a.title}`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg opacity-70 transition hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
