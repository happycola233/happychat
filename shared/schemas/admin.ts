import { z } from 'zod'

export const inviteCreateSchema = z.object({
  note: z.string().trim().max(120).optional(),
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
})

export const userUpdateSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
  /** 是否允许分享：null=随全局 */
  canShare: z.boolean().nullable().optional(),
})

/** 统计/事件查询的通用筛选（全部来自 query string，故先 coerce 再校验）。 */
export const statsFilterSchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  success: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  scope: z.enum(['upstream', 'server', 'stream', 'frontend']).optional(),
  search: z.string().trim().max(200).optional(),
  bucket: z.enum(['hour', 'day']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export type StatsFilterInput = z.infer<typeof statsFilterSchema>
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>
export type UserUpdateInput = z.infer<typeof userUpdateSchema>
