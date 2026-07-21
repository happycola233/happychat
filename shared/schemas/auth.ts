import { z } from 'zod'

export const usernameSchema = z
  .string()
  .trim()
  .min(1, '请输入用户名')
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
  // 是否必填由服务端的全局注册策略决定；空白统一归一为未提供。
  inviteCode: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => value || undefined),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
