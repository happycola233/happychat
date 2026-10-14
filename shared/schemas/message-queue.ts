import { z } from 'zod'
import { sendMessageSchema } from './chat'
import { modelParamsSchema } from './model-config'

export const queuedMessageSchema = z.object({
  id: z.uuid(),
  input: sendMessageSchema,
  attachments: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(['image', 'file']),
      mime: z.string(),
      filename: z.string(),
      byteSize: z.number().int().nonnegative(),
    }),
  ),
  imageSources: z.array(z.object({ attachmentId: z.string().min(1), label: z.string() })),
  modelName: z.string(),
  runPrefs: modelParamsSchema
    .pick({ web_search: true, x_search: true, reasoning_effort: true })
    .nullable(),
  reasoningEnabled: z.boolean(),
})

export type QueuedMessage = z.infer<typeof queuedMessageSchema>

export interface MessageQueueDTO {
  conversationId: string
  items: QueuedMessage[]
  parentId: string | null
  waitingRunId: string | null
  sendingId: string | null
  paused: boolean
  error: string | null
  revision: number
  reorderUntil: number | null
}

export const messageQueueActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('enqueue'),
    message: queuedMessageSchema,
    parentId: z.string().nullable(),
  }),
  z.object({ type: z.literal('remove'), messageId: z.uuid() }),
  z.object({ type: z.literal('take'), messageId: z.uuid() }),
  z.object({
    type: z.literal('reorder'),
    messageId: z.uuid().nullable(),
    targetId: z.uuid().nullable(),
  }),
  z.object({ type: z.literal('hold') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
])
export type MessageQueueAction = z.infer<typeof messageQueueActionSchema>
