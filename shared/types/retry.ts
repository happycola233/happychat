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
  failedAt: number
  errorType: string | null
  errorCode: string | null
  httpStatus: number | null
  message: string
  /** 脱敏并限长的上游原文，仅供诊断，不作为用户错误提示。 */
  rawMessage?: string
  nextRetryAt: number | null
  stopReason: RetryStopReason | null
}

/** 随请求审计固化；删除会话后也能还原重试经过，不依赖 run_events。 */
export interface RunRetrySummary {
  attempts: number
  outcome: UsageOutcome
  failures: RetryAttemptFailure[]
}
