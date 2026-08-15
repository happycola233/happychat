import type { MyQuotaDTO, UsageStatsDTO } from '@shared/types/api'
import type { UsageStatsView } from '@shared/types/domain'
import { apiGet } from './client'

/** 当前用户的额度视图；全局关闭限额时只会拿到 `enabled:false`。 */
export const getMyQuota = () =>
  apiGet<{ quota: MyQuotaDTO }>('/quota/me').then((response) => response.quota)

/**
 * 个人使用情况统计。IANA 时区让服务端按历史 DST 规则分桶；固定偏移仅用于兼容
 * 尚不认识 `timezone` 的旧服务端。
 */
export const getMyUsageStats = (params: {
  timezone?: string
  tzOffsetMinutes?: number
  days?: number
  view?: UsageStatsView
}) => {
  const search = new URLSearchParams()
  if (params.timezone) search.set('timezone', params.timezone)
  if (params.tzOffsetMinutes !== undefined) {
    search.set('tzOffsetMinutes', String(params.tzOffsetMinutes))
  }
  if (params.days) search.set('days', String(params.days))
  if (params.view) search.set('view', params.view)
  return apiGet<{ stats: UsageStatsDTO }>(`/quota/usage?${search.toString()}`).then(
    (response) => response.stats,
  )
}
