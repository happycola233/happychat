import { z } from 'zod'

export const usernameSchema = z
  .string()
  .trim()
  .min(3, '用户名至少 3 个字符')
  .max(32, '用户名最多 32 个字符')
  .regex(/^[a-zA-Z0-9_.-]+$/, '用户名只能包含字母、数字、下划线、点和短横线')

export const passwordSchema = z.string().min(6, '密码至少 6 位').max(128, '密码最多 128 位')

export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
})

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  inviteCode: z.string().trim().min(1).max(64).optional(),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
