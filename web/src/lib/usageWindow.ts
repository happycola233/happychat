import type { UsageStatsView } from '@shared/types/domain'

/** 浏览器 setTimeout 的 32 位上限稍作留白，避免较远的年末边界溢出成即时定时器。 */
export const MAX_USAGE_WINDOW_TIMER_MS = 2_147_000_000
const WINDOW_REFRESH_LAG_MS = 250

/**
 * 返回下一段等待时间；null 表示窗口边界已经过去，应立即刷新。
 * 较远边界会分段等待，但中途不会为了续接定时器而发网络请求。
 */
export function usageWindowTimerDelay(windowEnd: number, nowMs: number): number | null {
  const remaining = windowEnd + WINDOW_REFRESH_LAG_MS - nowMs
  if (remaining <= 0) return null
  return Math.min(remaining, MAX_USAGE_WINDOW_TIMER_MS)
}

/** placeholderData 期间必须沿用数据自身的口径，不能把旧数据套上新窗口标签。 */
export function displayedUsageView(
  requestedView: UsageStatsView,
  dataView: UsageStatsView | undefined,
): UsageStatsView {
  return dataView ?? requestedView
}
