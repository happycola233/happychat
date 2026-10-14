import type { RetryAttemptFailure, RetryAuditSummary } from '@shared/types/retry'
import { formatRequestLatency } from './requestEventDisplay'

export function retryFailureDurationLabel(failure: RetryAttemptFailure): string {
  return failure.requestStartedAt == null
    ? '请求耗时未记录'
    : `持续 ${formatRequestLatency(Math.max(0, failure.failedAt - failure.requestStartedAt))}后失败`
}

export function retrySummaryLabel(summary: RetryAuditSummary): string {
  if (summary.outcome === 'running')
    return summary.attempts <= 1 ? '等待重试' : `处理中 · 已重试 ${summary.attempts - 1} 次`
  if (summary.outcome === 'interrupted')
    return summary.attempts <= 1 ? '已中断' : `重试 ${summary.attempts - 1} 次后中断`
  if (summary.attempts <= 1) return '未重试'
  if (summary.outcome === 'completed') return `重试 ${summary.attempts - 1} 次后恢复`
  if (summary.outcome === 'canceled') return `重试 ${summary.attempts - 1} 次后停止`
  return `已重试 ${summary.attempts - 1} 次`
}
