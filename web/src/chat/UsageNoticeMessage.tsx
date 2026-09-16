import { Info, Lightbulb, TriangleAlert, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { ModelUsageNotice } from '@shared/schemas/user-notices'

const tones = {
  info: {
    icon: Info,
    color: 'text-sky-600 dark:text-sky-400',
    surface: 'bg-[#f0f7ff] dark:bg-[#1c252c]',
  },
  tip: {
    icon: Lightbulb,
    color: 'text-violet-600 dark:text-violet-400',
    surface: 'bg-[#f5f2fb] dark:bg-[#211e29]',
  },
  warning: {
    icon: TriangleAlert,
    color: 'text-amber-600 dark:text-amber-400',
    surface: 'bg-[#fdf7eb] dark:bg-[#28231b]',
  },
}

/** 使用提示独立于聊天历史，不会被重放给模型或混入导出。 */
export function UsageNoticeMessage({
  notice,
  modelName,
  onDismiss,
}: {
  notice: ModelUsageNotice
  modelName: string
  onDismiss?: () => void
}) {
  const style = tones[notice.tone]
  const Icon = style.icon
  return (
    <aside
      aria-label={`${modelName} 使用提示`}
      className={clsx('rounded-2xl px-4 py-3', style.surface)}
    >
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden className={clsx('mt-0.5 h-4 w-4 shrink-0', style.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
              {notice.title || '使用提示'}
            </p>
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{modelName}</span>
          </div>
          <p className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
            {notice.body}
          </p>
          {onDismiss && notice.frequency === 'once' && (
            <button
              type="button"
              onClick={onDismiss}
              className={clsx(
                'mt-1.5 min-h-8 rounded-lg text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-current',
                style.color,
              )}
            >
              知道了
            </button>
          )}
        </div>
        {onDismiss && notice.frequency === 'always' && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭使用提示"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-black/5 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50 dark:hover:bg-white/10 dark:hover:text-neutral-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </aside>
  )
}
