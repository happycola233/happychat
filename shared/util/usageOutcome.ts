import type { UsageOutcome, UsageResult } from '../types/domain'

/**
 * 把协议无关的终态与原因收敛为请求事件列表使用的结果分类。
 * refusal / content_filter 保持独立，其他失败统一归入 failed。
 */
export function resolveUsageResult(
  outcome: UsageOutcome,
  terminalReason: string | null,
): UsageResult {
  if (outcome !== 'failed') return outcome
  if (terminalReason === 'refusal') return 'refused'
  if (terminalReason === 'content_filter') return 'filtered'
  return 'failed'
}
