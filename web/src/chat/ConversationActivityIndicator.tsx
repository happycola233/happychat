import { clsx } from 'clsx'
import type { ConversationActivityState } from '../store/conversationActivity'

export function ConversationActivityIndicator({
  state,
  className,
}: {
  state: ConversationActivityState
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      data-conversation-activity={state}
      className={clsx('flex h-5 w-5 shrink-0 items-center justify-center', className)}
    >
      {state === 'generating' ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="hc-conversation-spinner h-4 w-4 text-neutral-400 dark:text-neutral-500"
        >
          <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
          <circle
            cx="12"
            cy="12"
            r="9.5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="42 17.7"
            transform="rotate(-90 12 12)"
          />
        </svg>
      ) : (
        <span className="hc-conversation-unread-dot h-2 w-2 rounded-full" />
      )}
    </span>
  )
}
