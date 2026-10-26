import { AlertCircle } from 'lucide-react'

/** 截断与中断保留已经生成的内容，并在实时、历史和分享视图中显示原因。 */
export function RunInterruptionNotice({
  message,
  hasAnswer,
}: {
  message: string
  hasAnswer: boolean
}) {
  return (
    <div
      role="status"
      data-testid="run-interruption-notice"
      className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="break-words">{message}</p>
        {!hasAnswer && <p className="mt-1">尚未生成最终回复。</p>}
      </div>
    </div>
  )
}
