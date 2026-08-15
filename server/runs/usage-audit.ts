import type { UsageOutcome } from '@shared/types/domain'

interface TerminalReasonInput {
  incompleteReason?: string | null
  errorType?: string | null
  errorCode?: string | null
}

/** 审计 error_type 优先保留协议类型；上游只给 code 时不得退化成笼统 error。 */
export function errorTypeForAudit(errorType?: string | null, errorCode?: string | null): string {
  return errorType ?? errorCode ?? 'error'
}

/** 把引擎终态附带的信息固化成 usage_logs 的协议无关终止原因。 */
export function terminalReasonForUsage(
  outcome: UsageOutcome,
  details: TerminalReasonInput = {},
): string | null {
  if (outcome === 'incomplete') return details.incompleteReason ?? null
  if (outcome === 'canceled') return 'user_cancelled'
  if (outcome === 'interrupted') return 'server_restart'
  if (outcome !== 'failed') return null

  // 两个需要独立展示的业务原因优先于普通上游 type/code。
  for (const reason of [details.errorCode, details.errorType]) {
    if (reason === 'refusal' || reason === 'content_filter') return reason
  }
  return details.errorCode ?? details.errorType ?? 'error'
}
