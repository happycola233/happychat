import { z } from 'zod'

export const inviteCreateSchema = z.object({
  note: z.string().trim().max(120).optional(),
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
})

export const userUpdateSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
})

export type InviteCreateInput = z.infer<typeof inviteCreateSchema>
export type UserUpdateInput = z.infer<typeof userUpdateSchema>
