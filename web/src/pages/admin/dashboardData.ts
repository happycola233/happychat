import type { AnalyticsSeriesPoint } from '@shared/types/api'
import type { UsageLogKind, UsageResult } from '@shared/types/domain'
import { RANGE_PRESETS, type RangeKey } from '../../lib/dateRange'
import { REQUEST_RESULT_LABELS } from './requestOutcome'

export function readDashboardFilters(params: URLSearchParams) {
  const range = params.get('range')
  const kind = params.get('kind')
  const result = params.get('result')
  return {
    rangeKey: (RANGE_PRESETS.some((item) => item.key === range) ? range : '7d') as RangeKey,
    providerId: params.get('providerId') ?? '',
    modelId: params.get('modelId') ?? '',
    userId: params.get('userId') ?? '',
    kindSel: (kind === 'chat' || kind === 'title' ? kind : '') as UsageLogKind | '',
    resultSel: (result && Object.hasOwn(REQUEST_RESULT_LABELS, result) ? result : '') as
      | UsageResult
      | '',
  }
}

export function dashboardHref(
  page: 'analytics' | 'request-events',
  filters: Record<string, string>,
) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ''))
  return `/admin/${page}?${params}`
}

/** 服务端按 UTC 分桶；补齐空桶才能让无请求时段真正回到零。 */
export function fillTimeBuckets<T extends { ts: number }>(
  rows: T[],
  bucket: 'hour' | 'day',
  from: number | undefined,
  to: number,
  empty: Omit<T, 'ts'>,
): T[] {
  if (!rows.length) return []
  const size = bucket === 'hour' ? 3_600_000 : 86_400_000
  const start = Math.floor((from ?? rows[0]!.ts) / size) * size
  const end = Math.floor(to / size) * size
  const byTime = new Map(rows.map((row) => [row.ts, row]))
  const result: T[] = []
  for (let ts = start; ts <= end; ts += size) result.push(byTime.get(ts) ?? ({ ...empty, ts } as T))
  return result
}

export const EMPTY_ANALYTICS_POINT: Omit<AnalyticsSeriesPoint, 'ts'> = {
  requests: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
}

export function summarizeAnalytics(series: AnalyticsSeriesPoint[]) {
  return series.reduce(
    (sum, point) => ({
      requests: sum.requests + point.requests,
      totalTokens: sum.totalTokens + point.totalTokens,
      inputTokens: sum.inputTokens + point.inputTokens,
      outputTokens: sum.outputTokens + point.outputTokens,
      cacheWriteTokens: sum.cacheWriteTokens + point.cacheWriteTokens,
      cachedTokens: sum.cachedTokens + point.cachedTokens,
      reasoningTokens: sum.reasoningTokens + point.reasoningTokens,
      costUsd: sum.costUsd + point.costUsd,
    }),
    { ...EMPTY_ANALYTICS_POINT },
  )
}

export function comparisonLabel(current: number, previous: number) {
  if (previous === 0) return current === 0 ? '与上一时段持平' : '上一时段为 0'
  const change = ((current - previous) / previous) * 100
  if (Math.abs(change) < 0.05) return '与上一时段持平'
  return `${change > 0 ? '↑' : '↓'} ${Math.abs(change).toFixed(1)}% 较上一时段`
}
