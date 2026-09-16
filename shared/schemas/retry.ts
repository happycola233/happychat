import { z } from 'zod'

export const RETRYABLE_HTTP_STATUSES = [408, 409, 429, 500, 502, 503, 504, 529] as const

const waitSecondsSchema = z
  .number('请输入正整数秒数')
  .int('请输入正整数秒数')
  .positive('等待时间必须大于 0 秒')

export const retryPolicySchema = z
  .object({
    enabled: z.boolean(),
    maxRetries: z.number().int().min(1).max(20),
    initialDelaySeconds: z.number().min(1).max(120),
    maxDelaySeconds: z.number().min(1).max(600),
    backoffMultiplier: z.number().min(1).max(5),
    jitterPercent: z.number().int().min(0).max(50),
    attemptTimeoutSeconds: waitSecondsSchema,
    maxElapsedSeconds: waitSecondsSchema,
    retryNetworkErrors: z.boolean(),
    retryStatusCodes: z
      .array(
        z
          .number()
          .refine(
            (code) =>
              RETRYABLE_HTTP_STATUSES.includes(code as (typeof RETRYABLE_HTTP_STATUSES)[number]),
            '请选择可重试的临时错误状态码',
          ),
      )
      .max(RETRYABLE_HTTP_STATUSES.length),
  })
  .refine((policy) => policy.maxDelaySeconds >= policy.initialDelaySeconds, {
    message: '最长等待时间不能小于首次等待时间',
    path: ['maxDelaySeconds'],
  })
  .refine((policy) => policy.maxElapsedSeconds >= policy.attemptTimeoutSeconds, {
    message: '总等待上限不能小于单次连接等待上限',
    path: ['maxElapsedSeconds'],
  })

export type RetryPolicy = z.infer<typeof retryPolicySchema>

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  enabled: false,
  maxRetries: 5,
  initialDelaySeconds: 5,
  maxDelaySeconds: 60,
  backoffMultiplier: 2,
  jitterPercent: 20,
  attemptTimeoutSeconds: 120,
  maxElapsedSeconds: 900,
  retryNetworkErrors: true,
  retryStatusCodes: [...RETRYABLE_HTTP_STATUSES],
}

/** 首次失败的序号为 1；抖动只增加等待，避免提前于配置或上游要求发送。 */
export function retryDelayMs(
  policy: RetryPolicy,
  retryNumber: number,
  random = Math.random(),
): number {
  const seconds = policy.initialDelaySeconds * policy.backoffMultiplier ** (retryNumber - 1)
  return Math.round(
    Math.min(policy.maxDelaySeconds, seconds * (1 + (random * policy.jitterPercent) / 100)) * 1000,
  )
}
