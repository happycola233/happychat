import { z } from 'zod'
import { retryPolicySchema } from './retry'
import { contextOptimizationSuggestionSchema } from './user-notices'

/** IANA 时区名：能被 Intl 接受才算合法，避免把非法值写进限额周期计算。 */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, '时区名称不合法')

/** 空文案表示不显示额外说明，额度状态与用量仍正常展示。 */
const quotaMessageSchema = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((value) => value || null)

export const appConfigUpdateSchema = z.object({
  registrationRequiresInviteCode: z.boolean().optional(),
  sharingEnabled: z.boolean().optional(),
  showCost: z.boolean().optional(),
  costCurrency: z.enum(['USD', 'CNY']).optional(),
  titleEnabled: z.boolean().optional(),
  titleModelId: z.string().min(1).nullable().optional(),
  titlePrompt: z.string().max(4000).nullable().optional(),
  quotaEnabled: z.boolean().optional(),
  quotaTimezone: timezoneSchema.optional(),
  quotaWeekStart: z.enum(['mon', 'sun']).optional(),
  // 阈值太低会让提示常驻；0.5–0.99 是有意义的区间。
  quotaWarnThreshold: z.number().min(0.5).max(0.99).optional(),
  quotaWarningMessage: quotaMessageSchema.optional(),
  quotaExhaustedMessage: quotaMessageSchema.optional(),
  contextOptimizationSuggestion: contextOptimizationSuggestionSchema.optional(),
  upstreamRetry: retryPolicySchema.optional(),
})

export type AppConfigUpdateInput = z.infer<typeof appConfigUpdateSchema>
