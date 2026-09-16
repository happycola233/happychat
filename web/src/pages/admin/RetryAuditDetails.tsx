import type { RunRetrySummary, RetryFailureStage, RetryStopReason } from '@shared/types/retry'
import { Badge } from '../../components/ui/Badge'
import { formatDateTime } from '../../lib/format'
import { retrySummaryLabel } from './retryAudit'

const stageLabels: Record<RetryFailureStage, string> = {
  connecting: '请求建立阶段',
  before_output: '已连接，尚未输出',
  after_output: '输出中断',
}
const stopLabels: Record<RetryStopReason, string> = {
  disabled: '自动重试已关闭',
  not_retryable: '此错误不自动重试',
  output_retry_disabled: '已关闭输出中断后重新生成',
  attempts_exhausted: '已达到重试次数上限',
  budget_exhausted: '已达到重试总时间上限',
  canceled: '用户已停止生成',
}

export function RetryAuditBadge({ summary }: { summary?: RunRetrySummary | null }) {
  if (!summary) return null
  return (
    <Badge tone={summary.outcome === 'completed' ? 'success' : 'neutral'}>
      {retrySummaryLabel(summary)}
    </Badge>
  )
}

/** 请求结果说明和错误日志共用同一份持久化尝试记录。 */
export function RetryAuditDetails({ summary }: { summary?: RunRetrySummary | null }) {
  if (!summary) return null
  return (
    <div className="space-y-2 border-t border-neutral-200 pt-3 text-xs dark:border-neutral-700">
      <p className="font-medium text-neutral-700 dark:text-neutral-200">
        {retrySummaryLabel(summary)}
      </p>
      <ol className="space-y-3">
        {summary.failures.map((failure) => (
          <li key={failure.attempt} className="space-y-1 text-neutral-600 dark:text-neutral-300">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">
                第 {failure.attempt} 次请求 · {stageLabels[failure.stage]}
              </span>
              <time className="text-[11px] text-neutral-500">
                {formatDateTime(failure.failedAt)}
              </time>
            </div>
            <p className="break-words whitespace-pre-wrap">{failure.message}</p>
            <p className="break-all text-[11px] text-neutral-500 dark:text-neutral-400">
              {failure.errorCode || failure.errorType || '未知错误'}
              {failure.httpStatus != null && ` · HTTP ${failure.httpStatus}`}
              {failure.httpStatus === 200 && '（响应中报错）'}
            </p>
            <p className="text-neutral-500 dark:text-neutral-400">
              {failure.stopReason
                ? stopLabels[failure.stopReason]
                : failure.nextRetryAt != null
                  ? `等待 ${Math.max(0, Math.round((failure.nextRetryAt - failure.failedAt) / 1000))} 秒后重试`
                  : ''}
            </p>
          </li>
        ))}
      </ol>
      {summary.attempts > 1 && (
        <p className="leading-5 text-neutral-500 dark:text-neutral-400">
          用量与成本包含各次尝试中上游已报告的用量。未返回用量的尝试无法精确计量。
        </p>
      )}
    </div>
  )
}
