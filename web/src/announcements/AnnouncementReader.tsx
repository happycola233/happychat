import type { ReactNode } from 'react'
import { Newspaper } from 'lucide-react'
import { Modal } from '../components/ui/Modal'
import { AnnouncementArticle } from './AnnouncementArticle'
import type { AnnouncementContent } from './AnnouncementArticle'

export function AnnouncementReader({
  announcement,
  onClose,
  dismissible = true,
  footer,
  preview = false,
}: {
  announcement: AnnouncementContent
  onClose: () => void
  dismissible?: boolean
  footer: ReactNode
  preview?: boolean
}) {
  return (
    <Modal
      open
      onClose={onClose}
      dismissible={dismissible}
      presentation="reading"
      animate={false}
      title={
        <span className="inline-flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <Newspaper className="h-4 w-4" aria-hidden="true" />
          {preview ? '公告预览' : '站内公告'}
          <span className="sr-only"> · {announcement.title}</span>
        </span>
      }
      bodyClassName="hc-scrollbar overflow-y-auto overscroll-contain px-6 pt-4 pb-7 sm:px-12 sm:pt-5 sm:pb-10"
      footer={footer}
    >
      <AnnouncementArticle announcement={announcement} />
    </Modal>
  )
}
