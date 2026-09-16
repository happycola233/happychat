import { z } from 'zod'
import { modelCreateSchema, modelParamsSchema } from './model-config'

export const requestPreviewModelSchema = modelCreateSchema.pick({
  providerId: true,
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
  userParams: modelParamsSchema.strict().optional(),
  includeHistory: z.boolean().default(true),
  includeImage: z.boolean().default(false),
  includeFile: z.boolean().default(false),
})

export type RequestPreviewInput = z.infer<typeof requestPreviewSchema>
