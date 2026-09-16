import { z } from 'zod'

export const contextOptimizationSuggestionSchema = z.object({
  enabled: z.boolean(),
  tokenThreshold: z.number().int().min(1000).max(2_000_000),
})

export type ContextOptimizationSuggestion = z.infer<typeof contextOptimizationSuggestionSchema>

export const DEFAULT_CONTEXT_OPTIMIZATION_SUGGESTION: ContextOptimizationSuggestion = {
  enabled: true,
  tokenThreshold: 100000,
}

export const modelUsageNoticeSchema = z
  .object({
    enabled: z.boolean(),
    title: z.string().trim().max(80),
    body: z.string().trim().max(2000),
    tone: z.enum(['info', 'tip', 'warning']),
    frequency: z.enum(['always', 'once']),
    dismissible: z.boolean(),
  })
  .refine((notice) => !notice.enabled || notice.body.length > 0, {
    message: '请填写使用提示正文',
    path: ['body'],
  })

export type ModelUsageNotice = z.infer<typeof modelUsageNoticeSchema>

export const DEFAULT_MODEL_USAGE_NOTICE: ModelUsageNotice = {
  enabled: false,
  title: '可能需要更长时间响应请求',
  body: '该模型需要更多时间进行深度推理，回复可能需要几分钟。你可以先处理其他事情，稍后回来查看。',
  tone: 'info',
  frequency: 'once',
  dismissible: true,
}
