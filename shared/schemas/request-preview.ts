import { z } from 'zod'
import { modelCreateSchema, modelParamsSchema, modelRouteInputSchema } from './model-config'

export const requestPreviewModelSchema = modelCreateSchema.pick({
  modelId: true,
  displayName: true,
  kind: true,
  capabilities: true,
  defaultSystemPrompt: true,
  defaultParams: true,
  hardParams: true,
  allowedEfforts: true,
  defaultEffort: true,
  replayProviderContext: true,
  defaultWebSearch: true,
  defaultXSearch: true,
})

export const requestPreviewSchema = z.object({
  model: requestPreviewModelSchema,
  /** 预览按哪条线路发送：决定供应商协议、地址、请求头与 model 字段。 */
  route: modelRouteInputSchema.pick({ providerId: true, upstreamModelId: true }),
  userParams: modelParamsSchema.strict().optional(),
  includeHistory: z.boolean().default(true),
  includeImage: z.boolean().default(false),
  includeFile: z.boolean().default(false),
})

export type RequestPreviewInput = z.infer<typeof requestPreviewSchema>
