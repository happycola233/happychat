import { clsx } from 'clsx'
import { Pin } from 'lucide-react'
import type { UserAnnouncementDTO } from '@shared/types/api'
import { Markdown } from '../chat/Markdown'
import { LEVEL_META } from '../lib/announcementMeta'
import './announcements.css'

export type AnnouncementContent = Pick<
  UserAnnouncementDTO,
  'title' | 'body' | 'level' | 'pinned' | 'publishAt' | 'createdAt'
>

/** 用户阅读、管理端预览与编辑器共用排版，预览即为最终展示效果。 */
export function AnnouncementArticle({ announcement }: { announcement: AnnouncementContent }) {
  const meta = LEVEL_META[announcement.level]
  const LevelIcon = meta.icon
  const publishedAt = new Date(announcement.publishAt ?? announcement.createdAt)

  return (
    <article className="hc-announcement-article mx-auto w-full min-w-0 max-w-[46rem]">
      <header className="mb-5 sm:mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span className={clsx('inline-flex items-center gap-1.5 font-medium', meta.accentClass)}>
            <LevelIcon className="h-4 w-4" aria-hidden="true" />
            {meta.label}
          </span>
          <span aria-hidden="true" className="text-neutral-300 dark:text-neutral-700">
            /
          </span>
          <time dateTime={publishedAt.toISOString()} title={publishedAt.toLocaleString('zh-CN')}>
            {publishedAt.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
          {announcement.pinned && (
            <span className="inline-flex items-center gap-1">
              <Pin className="h-3 w-3" aria-hidden="true" />
              置顶
            </span>
          )}
        </div>
        <h2 className="break-words text-[26px] leading-[1.35] font-semibold tracking-tight text-neutral-950 sm:text-[34px] dark:text-neutral-50">
          {announcement.title}
        </h2>
      </header>
      <Markdown text={announcement.body} className="hc-announcement-body" announcementImages />
    </article>
  )
}
