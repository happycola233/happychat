import type { QuotaBucketUsageDTO } from '@shared/types/api'

/** 滚动窗口的 periodStart 每毫秒移动，不能拿它做关闭键；其他周期仍用稳定起点区分。 */
export function quotaWarningDismissKey(rule: QuotaBucketUsageDTO): string {
  const target = `${rule.ruleId}:${rule.bucketKey ?? ''}`
  if (rule.window.type === 'rolling') {
    return `${target}:rolling:${rule.window.hours}:${rule.metric}:${rule.effectiveLimit ?? 'unlimited'}`
  }
  if (rule.window.type === 'total') return `${target}:total`
  return `${target}:${rule.periodStart}`
}
