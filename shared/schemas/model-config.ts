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

export const modelUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  kind: z.enum(['responses', 'image']).optional(),
  capabilities: capabilitiesSchema.optional(),
  defaultSystemPrompt: z.string().nullable().optional(),
  defaultParams: modelParamsSchema.nullable().optional(),
  hardParams: z.record(z.string(), z.unknown()).nullable().optional(),
  allowedEfforts: z.array(effortSchema).optional(),
  defaultEffort: effortSchema.nullable().optional(),
  defaultWebSearch: z.boolean().optional(),
  sort: z.number().int().optional(),
})

export type ProviderCreateInput = z.infer<typeof providerCreateSchema>
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>
export type ModelUpdateInput = z.infer<typeof modelUpdateSchema>
