import { z } from 'zod'

// 只验证可计数的整数，不把任何上游的容量限制固化在应用里。
const attachmentRetentionSchema = z.union([
  z.object({ mode: z.enum(['all', 'none']) }),
  z.object({ mode: z.enum(['rounds', 'items']), limit: z.number().int().positive() }),
])

export const contextPolicySchema = z.object({
  historyTurns: z.number().int().nonnegative().nullable(),
  uploads: attachmentRetentionSchema,
  generatedImages: attachmentRetentionSchema,
})

export const updateContextPolicySchema = z.object({ contextPolicy: contextPolicySchema })

export const contextAttachmentSelectionSchema = z
  .object({
    include: z.array(z.string().min(1)),
    exclude: z.array(z.string().min(1)),
  })
  .refine(
    (value) => !value.include.some((id) => value.exclude.includes(id)),
    '同一附件不能同时选中和排除',
  )
