import { z } from 'zod'
import { ACCENT_COLORS } from '../util/preferences'
import { passwordSchema, usernameSchema } from './auth'

export const themePreferenceSchema = z.enum(['system', 'light', 'dark'])
export const accentColorSchema = z.enum(ACCENT_COLORS)
export const messageFontSizeSchema = z.enum(['small', 'medium', 'large'])

/** 偏好局部更新：所有字段可选，仅校验传入项。 */
export const userPreferencesPatchSchema = z
  .object({
    autoScrollOnOpen: z.boolean(),
    showScrollToBottom: z.boolean(),
    showTimelineNav: z.boolean(),
    sendOnEnter: z.boolean(),
    defaultExpandReasoning: z.boolean(),
    accentColor: accentColorSchema,
    messageFontSize: messageFontSizeSchema,
    showMessageTime: z.boolean(),
    messageTimeFormat: z.enum(['time', 'datetime']),
    showModelLabel: z.boolean(),
    showUsageStats: z.boolean(),
  })
  .partial()

export const updateSettingsSchema = z
  .object({
    theme: themePreferenceSchema.optional(),
    preferences: userPreferencesPatchSchema.optional(),
  })
  .refine((v) => v.theme !== undefined || v.preferences !== undefined, '无可更新的设置项')

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码'),
  newPassword: passwordSchema,
})

export const displayNameSchema = z.string().trim().max(48, '昵称最多 48 个字符').nullable()

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: displayNameSchema.optional(),
  })
  .refine((v) => v.username !== undefined || v.displayName !== undefined, '无可更新的资料项')

export const deleteAccountSchema = z.object({
  password: z.string().min(1, '请输入密码以确认删除'),
})

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>
export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>
