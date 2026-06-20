import { z } from 'zod'
import { modelParamsSchema } from './model-config'

export const attachmentRefSchema = z.object({
  attachmentId: z.string().min(1),
  kind: z.enum(['image', 'file']),
  filename: z.string(),
  detail: z.enum(['auto', 'low', 'high']).optional(),
})

export const imageSourceSchema = z.object({
  attachmentId: z.string().min(1),
  detail: z.enum(['auto', 'low', 'high']).optional(),
})

export const sendMessageSchema = z
  .object({
    conversationId: z.string().optional(),
    modelId: z.string().min(1, '请选择模型'),
    text: z.string().max(100_000).default(''),
    /** 用户可调参数（思考等级、联网开关等） */
    params: modelParamsSchema.optional(),
    /** 发起生成时的浏览器首选语言，用于标题总结等服务端异步任务。 */
    clientLocale: z.string().trim().min(1).max(64).optional(),
    /** 幂等键，避免重复提交触发两次上游调用 */
    idempotencyKey: z.string().max(64).optional(),
    /** 编辑重发：被编辑用户消息的 parentId，使新消息成为兄弟分支 */
    parentId: z.string().nullable().optional(),
    /** 附件引用（图片/文件） */
    attachments: z.array(attachmentRefSchema).max(10).optional(),
    /** 显式选择的已有图片编辑源（不重新归属 attachment.messageId） */
    imageSources: z.array(imageSourceSchema).max(16).optional(),
  })
  .refine(
    (v) =>
      v.text.trim().length > 0 ||
      (v.attachments?.length ?? 0) > 0 ||
      (v.imageSources?.length ?? 0) > 0,
    {
      message: '消息不能为空',
      path: ['text'],
    },
  )

export type SendMessageInput = z.infer<typeof sendMessageSchema>

export const renameConversationSchema = z.object({
  title: z.string().trim().min(1).max(120),
})

export const pinConversationSchema = z.object({
  pinned: z.boolean(),
})

export const regenerateSchema = z.object({
  assistantMessageId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  params: modelParamsSchema.optional(),
  /** 发起重新生成时的浏览器首选语言，用于标题总结等服务端异步任务。 */
  clientLocale: z.string().trim().min(1).max(64).optional(),
  idempotencyKey: z.string().max(64).optional(),
})

export const switchBranchSchema = z.object({
  messageId: z.string().min(1),
})

export type RegenerateInput = z.infer<typeof regenerateSchema>
export type SwitchBranchInput = z.infer<typeof switchBranchSchema>
export type PinConversationInput = z.infer<typeof pinConversationSchema>
