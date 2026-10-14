import type { UsageOutcome } from './domain'

export type RetryFailureStage = 'connecting' | 'before_output' | 'after_output'
export type RetryStopReason =
  | 'disabled'
  | 'not_retryable'
  | 'output_retry_disabled'
  | 'attempts_exhausted'
  | 'budget_exhausted'
  | 'canceled'

export interface RetryAttemptFailure {
  attempt: number
  stage: RetryFailureStage
  /** 本次尝试首次实际向上游发送请求的时间；旧审计缺省，未发出请求为 null。 */
  requestStartedAt?: number | null
  failedAt: number
  /** 下一次尝试实际发起请求的时间；区别于计划中的 nextRetryAt。 */
  retriedAt?: number
  errorType: string | null
  errorCode: string | null
  httpStatus: number | null
  message: string
  /** 脱敏并限长的上游原文，仅供诊断，不作为用户错误提示。 */
  rawMessage?: string
  nextRetryAt: number | null
  stopReason: RetryStopReason | null
}

/** 错误发生时立即记录，生成期间持续更新，结束后固化最终结果。 */
export interface RetryAuditSummary {
  attempts: number
  outcome: UsageOutcome | 'running'
  failures: RetryAttemptFailure[]
}

/** 随请求结算固化；删除会话后也能还原重试经过，不依赖 run_events。 */
export interface RunRetrySummary extends RetryAuditSummary {
  outcome: UsageOutcome
}
