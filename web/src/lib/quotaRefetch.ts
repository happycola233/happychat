import type { QuotaBucketUsageDTO } from '@shared/types/api'

const ROLLING_QUOTA_POLL_MS = 30_000
const MAX_SAFE_TIMER_MS = 2_147_000_000

export interface QuotaRefetchOptions {
  warnThreshold: number
  /** 管理页始终展示精确周期，因此即使用量正常，也要在固定边界跨越后刷新日期。 */
  refreshAllFixedBoundaries?: boolean
}

/**
 * 计算时间流逝本身会让额度快照失真的最近时刻。
 *
 * - 滚动窗口没有固定重置点，仅在接近/达到上限时短轮询，及时展示逐步释放；
 * - 自然周期和首次请求固定周期在精确结束点后刷新一次；
 * - 未启动周期、永久累计和豁免规则无需定时刷新。
 */
export function resolveQuotaRulesRefetchInterval(
  rules: QuotaBucketUsageDTO[],
  options: QuotaRefetchOptions,
  now = Date.now(),
): number | false {
  let nextDelay = Number.POSITIVE_INFINITY

  for (const rule of rules) {
    if (rule.limit.kind !== 'amount' || !rule.periodActive) continue

    const isEffective = !rule.invalid && !rule.shadowed
    const isNearLimit =
      isEffective && (rule.blocked || (rule.percent ?? 0) >= options.warnThreshold)

    if (rule.window.type === 'rolling') {
      if (isNearLimit) nextDelay = Math.min(nextDelay, ROLLING_QUOTA_POLL_MS)
      continue
    }

    if (rule.periodEnd !== null && (options.refreshAllFixedBoundaries || isNearLimit)) {
      nextDelay = Math.min(nextDelay, Math.max(1_000, rule.periodEnd - now + 250))
    }
  }

  return Number.isFinite(nextDelay) ? Math.min(nextDelay, MAX_SAFE_TIMER_MS) : false
}
