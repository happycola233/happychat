import type { MyQuotaDTO, UsageStatsDTO } from '@shared/types/api'
import { apiGet } from './client'

/** 当前用户的额度视图；全局关闭限额时只会拿到 `enabled:false`。 */
export const getMyQuota = () =>
  apiGet<{ quota: MyQuotaDTO }>('/quota/me').then((response) => response.quota)

/**
 * 个人使用情况统计。热力图按用户本地日分格，因此必须把浏览器时区偏移带上
 * （`-getTimezoneOffset()`：东八区为 +480）。
 */
export const getMyUsageStats = (params: { tzOffsetMinutes: number; days?: number }) => {
  const search = new URLSearchParams({ tzOffsetMinutes: String(params.tzOffsetMinutes) })
  if (params.days) search.set('days', String(params.days))
  return apiGet<{ stats: UsageStatsDTO }>(`/quota/usage?${search.toString()}`).then(
    (response) => response.stats,
  )
}
