import { z } from 'zod'
import { defaultReasoningEffortDescription } from '../constants'
import { isSafeReasoningEffortValue } from '../util/reasoning'

export const providerCreateSchema = z.object({
  name: z.string().trim().min(1, '请填写名称').max(60),
  baseUrl: z.string().url('Base URL 格式不正确'),
  apiKey: z.string().min(1, '请填写 API Key'),
})

export const providerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  baseUrl: z.string().url('Base URL 格式不正确').optional(),
  apiKey: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
})

export const capabilitiesSchema = z.object({
  vision: z.boolean(),
  file_input: z.boolean(),
  web_search: z.boolean(),
  image_generation: z.boolean(),
  reasoning: z.boolean(),
})

/** reasoning.effort 是上游标识符：允许自定义，但禁止空白和控制字符。 */
export const effortSchema = z
  .string()
  .trim()
  .min(1, '请填写推理等级值')
  .max(64, '推理等级值不能超过 64 个字符')
  .refine(isSafeReasoningEffortValue, '推理等级值不能包含空白、控制或不可见字符')

export const reasoningEffortOptionSchema = z.object({
  value: effortSchema,
  description: z.string().trim().min(1, '请填写推理等级描述').max(80, '描述不能超过 80 个字符'),
})

// 兼容旧管理端提交的 string[]；服务端解析后始终得到对象数组。
const reasoningEffortOptionInputSchema = z.union([
  reasoningEffortOptionSchema,
  effortSchema.transform((value) => ({
    value,
    description: defaultReasoningEffortDescription(value),
  })),
])

export const reasoningEffortOptionsSchema = z
  .array(reasoningEffortOptionInputSchema)
  .max(16, '单个模型最多配置 16 个推理等级')
  .superRefine((options, ctx) => {
    const seen = new Set<string>()
    options.forEach((option, index) => {
      if (seen.has(option.value)) {
        ctx.addIssue({
          code: 'custom',
          message: `推理等级值「${option.value}」重复`,
          path: [index, 'value'],
        })
      }
      seen.add(option.value)
    })
  })

/** 用户可见的模型简介，选择器 ⓘ 展示。 */
export const modelDescriptionSchema = z
  .string()
  .trim()
  .max(500, '模型描述不能超过 500 个字符')

/** 用户可见的模型标签，直接显示在模型列表里。 */
export const modelTagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, '标签不能为空')
      .max(16, '单个标签不能超过 16 个字符'),
  )
  .max(8, '单个模型最多 8 个标签')
  .refine((tags) => new Set(tags).size === tags.length, '标签不能重复')

export const imageOptionsSchema = z.object({
  size: z.string().optional(),
  quality: z.string().optional(),
  background: z.string().optional(),
})

export const modelParamsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  verbosity: z.enum(['low', 'medium', 'high']).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  reasoning_effort: effortSchema.optional(),
  web_search: z.boolean().optional(),
  image: imageOptionsSchema.optional(),
})

/** 按模型定价（USD / 1M tokens），各项可选、非负。 */
export const pricingSchema = z.object({
  input: z.number().min(0).optional(),
  cacheWriteInput: z.number().min(0).optional(),
  cachedInput: z.number().min(0).optional(),
  output: z.number().min(0).optional(),
  image: z.number().min(0).optional(),
})

export const modelUpdateSchema = z.object({
  modelId: z.string().trim().min(1).max(120).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  description: modelDescriptionSchema.nullable().optional(),
  tags: modelTagsSchema.optional(),
  enabled: z.boolean().optional(),
  kind: z.enum(['responses', 'chat', 'image']).optional(),
  capabilities: capabilitiesSchema.optional(),
  defaultSystemPrompt: z.string().nullable().optional(),
  defaultParams: modelParamsSchema.nullable().optional(),
  hardParams: z.record(z.string(), z.unknown()).nullable().optional(),
  pricing: pricingSchema.nullable().optional(),
  allowedEfforts: reasoningEffortOptionsSchema.optional(),
  defaultEffort: effortSchema.nullable().optional(),
  defaultWebSearch: z.boolean().optional(),
  sort: z.number().int().optional(),
})

const defaultCapabilities = {
  vision: false,
  file_input: false,
  web_search: false,
  image_generation: false,
  reasoning: false,
}

/** 手动添加模型：providerId + modelId 必填，其余给合理默认。 */
export const modelCreateSchema = z.object({
  providerId: z.string().min(1, '请选择所属供应商'),
  modelId: z.string().trim().min(1, '请填写模型 ID').max(120),
  displayName: z.string().trim().min(1, '请填写显示名称').max(80),
  description: modelDescriptionSchema.nullable().optional(),
  tags: modelTagsSchema.default([]),
  kind: z.enum(['responses', 'chat', 'image']).default('responses'),
  enabled: z.boolean().default(true),
  capabilities: capabilitiesSchema.default(defaultCapabilities),
  defaultSystemPrompt: z.string().nullable().optional(),
  defaultParams: modelParamsSchema.nullable().optional(),
  hardParams: z.record(z.string(), z.unknown()).nullable().optional(),
  pricing: pricingSchema.nullable().optional(),
  allowedEfforts: reasoningEffortOptionsSchema.default([]),
  defaultEffort: effortSchema.nullable().optional(),
  defaultWebSearch: z.boolean().default(false),
  sort: z.number().int().default(0),
})

/** 管理端从上游目录挑选模型批量添加（每个 id 新建一个实例，同 id 可多实例）。 */
export const modelImportSchema = z.object({
  modelIds: z
    .array(z.string().trim().min(1).max(120))
    .min(1, '请选择要添加的模型')
    .max(200, '一次最多添加 200 个模型'),
})

/** 管理员在模型列表中拖/点排序后，一次性提交完整顺序，避免相邻模型 sort 冲突。 */
export const modelReorderSchema = z.object({
  modelIds: z
    .array(z.string().min(1))
    .min(1, '请选择要排序的模型')
    .refine((ids) => new Set(ids).size === ids.length, '模型顺序不能包含重复项'),
})

export type ProviderCreateInput = z.infer<typeof providerCreateSchema>
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>
export type ModelUpdateInput = z.infer<typeof modelUpdateSchema>
export type ModelCreateInput = z.infer<typeof modelCreateSchema>
export type ModelImportInput = z.infer<typeof modelImportSchema>
export type ModelReorderInput = z.infer<typeof modelReorderSchema>
