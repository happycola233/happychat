import type { RunRetrySummary } from '@shared/types/retry'

export function retrySummaryLabel(summary: RunRetrySummary): string {
  if (summary.attempts <= 1) return '未重试'
  if (summary.outcome === 'completed') return `重试 ${summary.attempts - 1} 次后恢复`
  if (summary.outcome === 'canceled') return `重试 ${summary.attempts - 1} 次后停止`
  return `已重试 ${summary.attempts - 1} 次`
}
