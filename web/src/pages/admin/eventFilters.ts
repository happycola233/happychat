import type { StatsQuery } from '../../api/admin'
import type { UsageResult } from '@shared/types/domain'
import { rangeToFilter, type RangeKey } from '../../lib/dateRange'

export interface UsageEventsFilterState {
  rangeKey: RangeKey
  providerId: string
  modelId: string
  userId: string
  /** 用户可见结果分类；比旧 success 布尔值能准确表达截断、取消、拒绝与过滤。 */
  resultSel: UsageResult | ''
  /** 请求类型：''=全部，'chat'=仅对话，'title'=仅标题总结 */
  kindSel: string
  page: number
  pageSize: number
}

export interface ErrorEventsFilterState {
  rangeKey: RangeKey
  scopeSel: string
  search: string
  page: number
  pageSize: number
}

/**
 * Query key 必须使用稳定的筛选原值，不能塞 rangeToFilter() 生成的 from。
 * from 带 Date.now()，放进 key 会让每次 render 都变成一次全新的查询。
 */
export function usageEventsQueryKey(filter: UsageEventsFilterState) {
  return [
    'admin',
    'usage-events',
    filter.rangeKey,
    filter.providerId,
    filter.modelId,
    filter.userId,
    filter.resultSel,
    filter.kindSel,
    filter.page,
    filter.pageSize,
  ] as const
}

export function buildUsageEventsQuery(filter: UsageEventsFilterState): StatsQuery {
  return {
    ...rangeToFilter(filter.rangeKey),
    providerId: filter.providerId || undefined,
    modelId: filter.modelId || undefined,
    userId: filter.userId || undefined,
    result: filter.resultSel || undefined,
    kind: filter.kindSel === 'chat' || filter.kindSel === 'title' ? filter.kindSel : undefined,
    page: filter.page,
    pageSize: filter.pageSize,
  }
}

export function errorEventsQueryKey(filter: ErrorEventsFilterState) {
  return [
    'admin',
    'error-events',
    filter.rangeKey,
    filter.scopeSel,
    filter.search.trim(),
    filter.page,
    filter.pageSize,
  ] as const
}

export function buildErrorEventsQuery(filter: ErrorEventsFilterState): StatsQuery {
  return {
    ...rangeToFilter(filter.rangeKey),
    scope: filter.scopeSel || undefined,
    search: filter.search.trim() || undefined,
    page: filter.page,
    pageSize: filter.pageSize,
  }
}
