import { AlertCircle } from 'lucide-react'
import type { MessageErrorDetail } from '@shared/types/domain'
import { classifyRunError } from '@shared/util/runError'
import { useMe } from '../hooks/useAuth'
import { ContextIcon } from './icons'
import { runErrorAdvice, runErrorMetaParts } from './runErrorAdvice'

interface Props {
  message: string
  /** 升级前的失败消息没有结构化信息，只展示原有文案。 */
  detail?: MessageErrorDetail | null
  onOpenContextSettings?: () => void
}

/** 生成失败卡片：原因、可执行的建议，以及便于反馈的错误码。 */
export function RunErrorNotice({ message, detail, onOpenContextSettings }: Props) {
  const { data: me } = useMe()
  const advice = detail ? runErrorAdvice(classifyRunError(detail), me?.role === 'admin') : null
  const meta = detail ? runErrorMetaParts(detail) : []
  if (detail?.retryCount) meta.push(`已自动重试 ${detail.retryCount} 次`)
  const showContextAction = advice?.action === 'context' && Boolean(onOpenContextSettings)

  return (
    <div
      className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm dark:bg-red-950/30"
      data-testid="run-error-notice"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-red-600 dark:text-red-400">{message}</p>
        {advice?.hint && (
          <p className="mt-1 text-[13px] leading-5 text-neutral-600 dark:text-neutral-300">
            {advice.hint}
          </p>
        )}
        {(showContextAction || meta.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            {showContextAction && (
              <button
                type="button"
                onClick={onOpenContextSettings}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 text-xs font-medium text-neutral-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 dark:border-red-900/60 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-red-950/40"
              >
                <ContextIcon className="h-3.5 w-3.5" />
                调整上下文
              </button>
            )}
            {meta.length > 0 && (
              <span className="break-all text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
                {meta.join(' · ')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
