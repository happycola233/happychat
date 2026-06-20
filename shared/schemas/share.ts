import { z } from 'zod'

export const createShareSchema = z.object({
  showAvatar: z.boolean().default(true),
  showName: z.boolean().default(true),
  /** 有效期天数；null/缺省 = 永久 */
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
})

export const updateShareSchema = z.object({
  showAvatar: z.boolean().optional(),
  showName: z.boolean().optional(),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
})

export type CreateShareInput = z.infer<typeof createShareSchema>
export type UpdateShareInput = z.infer<typeof updateShareSchema>
