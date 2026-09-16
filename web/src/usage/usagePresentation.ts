import type { UsageModelStatDTO } from '@shared/types/api'
import type { UsageStatsView } from '@shared/types/domain'
import { formatQuotaCostUsd } from '@shared/util/quota'
import { formatCompact, formatInt } from '../lib/format'

export type UsageMetric = 'requests' | 'totalTokens' | 'costUsd'

export const USAGE_VIEWS: { value: UsageStatsView; label: string }[] = [
  { value: 'day', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'year', label: '本年' },
]
export const USAGE_METRICS: { value: UsageMetric; label: string }[] = [
  { value: 'requests', label: '请求' },
  { value: 'totalTokens', label: 'Token' },
  { value: 'costUsd', label: '花费' },
]

/** URL 是输入边界；未知窗口与没有选择时都使用本月。 */
export function readUsageView(value: string | null): UsageStatsView {
  return USAGE_VIEWS.find((option) => option.value === value)?.value ?? 'month'
}

export function formatUsageMetric(value: number, metric: UsageMetric, exact = false): string {
  if (metric === 'costUsd') {
    return exact
      ? '$' + value.toLocaleString('en-US', { maximumFractionDigits: 12 })
      : formatQuotaCostUsd(value)
  }
  return exact || metric === 'requests' ? formatInt(value) : formatCompact(value)
}
export function usageModelKey(row: UsageModelStatDTO): string {
  return JSON.stringify([row.modelId, row.modelLabel])
}
export function filterAndSortModels(
  rows: UsageModelStatDTO[],
  search: string,
  metric: UsageMetric,
): UsageModelStatDTO[] {
  const term = search.trim().toLocaleLowerCase()
  return rows
    .filter((row) => row.modelLabel.toLocaleLowerCase().includes(term))
    .sort(
      (a, b) =>
        b[metric] - a[metric] ||
        b.requests - a.requests ||
        a.modelLabel.localeCompare(b.modelLabel, 'zh-CN'),
    )
}
export function usageDateRange(start: number, end: number, timeZone?: string): string {
  const format = (ts: number) =>
    new Date(ts).toLocaleDateString('zh-CN', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
  const from = format(start)
  const to = format(end)
  return from === to ? from : from + ' – ' + to
}
