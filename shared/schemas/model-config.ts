import { z } from 'zod'

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

export const effortSchema = z.enum(['none', 'low', 'medium', 'high', 'xhigh'])

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
  cachedInput: z.number().min(0).optional(),
  output: z.number().min(0).optional(),
  image: z.number().min(0).optional(),
})

export const modelUpdateSchema = z.object({
  modelId: z.string().trim().min(1).max(120).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  kind: z.enum(['responses', 'chat', 'image']).optional(),
  capabilities: capabilitiesSchema.optional(),
  defaultSystemPrompt: z.string().nullable().optional(),
  defaultParams: modelParamsSchema.nullable().optional(),
  hardParams: z.record(z.string(), z.unknown()).nullable().optional(),
  pricing: pricingSchema.nullable().optional(),
  allowedEfforts: z.array(effortSchema).optional(),
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
  kind: z.enum(['responses', 'chat', 'image']).default('responses'),
  enabled: z.boolean().default(true),
  capabilities: capabilitiesSchema.default(defaultCapabilities),
  defaultSystemPrompt: z.string().nullable().optional(),
  defaultParams: modelParamsSchema.nullable().optional(),
  hardParams: z.record(z.string(), z.unknown()).nullable().optional(),
  pricing: pricingSchema.nullable().optional(),
  allowedEfforts: z.array(effortSchema).default([]),
  defaultEffort: effortSchema.nullable().optional(),
  defaultWebSearch: z.boolean().default(false),
  sort: z.number().int().default(0),
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
export type ModelReorderInput = z.infer<typeof modelReorderSchema>
