import type { RetryAttemptFailure, RetryAuditSummary } from '@shared/types/retry'
import { formatDateTime } from '../../lib/format'
import { formatRequestLatency } from './requestEventDisplay'

export function retryFailureDurationLabel(failure: RetryAttemptFailure): string {
  return failure.requestStartedAt == null
    ? '请求耗时未记录'
    : `持续 ${formatRequestLatency(Math.max(0, failure.failedAt - failure.requestStartedAt))}后失败`
}

export function retrySummaryLabel(summary: RetryAuditSummary): string {
  const label = retryOutcomeLabel(summary)
  const failovers = summary.failures.filter((failure) => failure.nextAction === 'failover').length
  return failovers > 0 ? `${label}（含切换线路 ${failovers} 次）` : label
}

/** 失败后的下一步：立即换线路、等待后重试，或停止的原因。 */
export function retryNextStepLabel(
  failure: RetryAttemptFailure,
  stopLabels: Record<NonNullable<RetryAttemptFailure['stopReason']>, string>,
): string {
  if (failure.stopReason) return stopLabels[failure.stopReason]
  if (failure.nextAction === 'failover') return '立即切换到下一条线路'
  if (failure.retriedAt != null)
    return `等待 ${formatRequestLatency(Math.max(0, failure.retriedAt - failure.failedAt))}后重试 · ${formatDateTime(failure.retriedAt)}`
  if (failure.nextRetryAt != null)
    return `计划等待 ${formatRequestLatency(Math.max(0, failure.nextRetryAt - failure.failedAt))}后重试`
  return ''
}

function retryOutcomeLabel(summary: RetryAuditSummary): string {
  if (summary.outcome === 'running')
    return summary.attempts <= 1 ? '等待重试' : `处理中 · 已重试 ${summary.attempts - 1} 次`
  if (summary.outcome === 'interrupted')
    return summary.attempts <= 1 ? '已中断' : `重试 ${summary.attempts - 1} 次后中断`
  if (summary.attempts <= 1) return '未重试'
  if (summary.outcome === 'completed') return `重试 ${summary.attempts - 1} 次后恢复`
  if (summary.outcome === 'canceled') return `重试 ${summary.attempts - 1} 次后停止`
  return `已重试 ${summary.attempts - 1} 次`
}
