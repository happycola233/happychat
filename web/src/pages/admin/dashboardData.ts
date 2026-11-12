import type { AnalyticsSeriesPoint } from '@shared/types/api'
import type { CostBasis, UsageLogKind, UsageResult } from '@shared/types/domain'
import { readDateRange, resolveDateRange, type DateRange } from '../../lib/dateRange'
import { formatCurrency } from '../../lib/format'
import { REQUEST_RESULT_LABELS } from './requestOutcome'

export function readDashboardFilters(params: URLSearchParams) {
  const kind = params.get('kind')
  const result = params.get('result')
  return {
    range: readDateRange(params),
    providerId: params.get('providerId') ?? '',
    modelId: params.get('modelId') ?? '',
    userId: params.get('userId') ?? '',
    kindSel: (kind === 'chat' || kind === 'title' ? kind : '') as UsageLogKind | '',
    resultSel: (result && Object.hasOwn(REQUEST_RESULT_LABELS, result) ? result : '') as
      | UsageResult
      | '',
    // 金额口径：默认上游真实成本，切换到用户计费可对照收入。
    costBasis: (params.get('basis') === 'billed' ? 'billed' : 'upstream') as CostBasis,
  }
}

/** 金额口径在界面上的短称。 */
export const COST_BASIS_LABELS: Record<CostBasis, string> = {
  upstream: '成本',
  billed: '计费',
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
  cost: 0,
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
      cost: sum.cost + point.cost,
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

/** 概览「上一时段」的说明；与服务端 getOverview 的同期窗口算法一致。 */
export function previousPeriodNote(range: DateRange, now = Date.now()): string {
  if (range.key === 'today') return '对比昨日同一时段'
  return resolveDateRange(range, now).end > now
    ? '对比上一等长时段的同期'
    : '对比紧邻所选区间的等长上一时段'
}

/** 趋势图补零的终点：不超过当前时刻，也不越过开区间终点所在的桶。 */
export function chartEnd(range: DateRange, now: number): number {
  return Math.min(resolveDateRange(range, now).end - 1, now)
}

/** 计费减成本即毛利；没有计费金额时不计算比例。 */
export function marginLabel(billed: number, cost: number): string {
  const margin = billed - cost
  const ratio = billed > 0 ? `（${Math.round((margin / billed) * 100)}%）` : ''
  return `毛利 ${formatCurrency(margin)}${ratio}`
}
