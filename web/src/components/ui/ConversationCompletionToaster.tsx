import { X } from 'lucide-react'
import {
  useConversationActivityStore,
  type ConversationCompletionNotice,
} from '../../store/conversationActivity'
import { useIsMobile, useSidebarStore } from '../../store/sidebar'

export function ConversationCompletionToasterView({
  notices,
  onOpenConversation,
  onDismissNotice,
  hideVisual = false,
}: {
  notices: ConversationCompletionNotice[]
  onOpenConversation: (conversationId: string) => void
  onDismissNotice: (noticeId: string) => void
  hideVisual?: boolean
}) {
  const latestNotice = notices.at(-1)

  return (
    <>
      {/* 常驻 polite live region：完成提醒不抢焦点、也不打断读屏器正在朗读的内容。 */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {latestNotice ? `${latestNotice.title}。${latestNotice.message}` : ''}
      </div>
      <section
        aria-label="回复完成通知"
        className={`pointer-events-none fixed right-3 top-3 z-[90] w-[min(26rem,calc(100vw-4.5rem))] flex-col items-end gap-2 sm:right-4 sm:top-4 sm:w-[min(26rem,calc(100vw-2rem))] ${hideVisual ? 'hidden' : 'flex'}`}
      >
        {notices.map((notice) => (
          <article
            key={notice.id}
            data-testid="conversation-completion-notice"
            className="hc-pop-in pointer-events-auto relative w-full overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_16px_45px_-12px_rgb(0_0_0/0.24)] dark:border-white/10 dark:bg-neutral-900 dark:shadow-[0_18px_50px_-12px_rgb(0_0_0/0.72)]"
          >
            <button
              type="button"
              onClick={() => onOpenConversation(notice.conversationId)}
              aria-label={`打开会话：${notice.title}`}
              className="block w-full px-5 py-4 pr-12 text-left outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 dark:hover:bg-neutral-800/70 dark:focus-visible:bg-neutral-800/70"
            >
              <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {notice.title}
              </span>
              <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
                {notice.message}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDismissNotice(notice.id)}
              aria-label="关闭回复完成通知"
              className="absolute right-2.5 top-2.5 rounded-lg p-1.5 text-neutral-400 opacity-70 transition hover:bg-neutral-100 hover:text-neutral-700 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          </article>
        ))}
      </section>
    </>
  )
}

export function ConversationCompletionToaster({
  onOpenConversation,
}: {
  onOpenConversation: (conversationId: string) => void
}) {
  const notices = useConversationActivityStore((state) => state.completionNotices)
  const dismissNotice = useConversationActivityStore((state) => state.dismissNotice)
  const markViewed = useConversationActivityStore((state) => state.markViewed)
  const mobileSidebarOpen = useSidebarStore((state) => state.mobileOpen)
  const isMobile = useIsMobile()

  return (
    <ConversationCompletionToasterView
      notices={notices}
      onOpenConversation={(conversationId) => {
        markViewed(conversationId)
        onOpenConversation(conversationId)
      }}
      onDismissNotice={dismissNotice}
      hideVisual={isMobile && mobileSidebarOpen}
    />
  )
}
