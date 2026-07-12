import { z } from 'zod'

/** 文件夹主题色：仅接受 #RRGGBB 十六进制格式。 */
export const folderColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色格式不正确')

/**
 * 文件夹图标：单个 emoji 可能由多个码点组成（肤色修饰、ZWJ 组合），按字素簇
 * 校验「恰好一个字形」——拦下整段文本，同时放行组合 emoji（单个汉字/字母也可作图标）。
 */
export const folderEmojiSchema = z
  .string()
  .trim()
  .min(1)
  .max(20, '图标格式不正确')
  .refine((value) => [...new Intl.Segmenter().segment(value)].length === 1, '图标只能是单个表情')

export const folderNameSchema = z
  .string()
  .trim()
  .min(1, '请输入文件夹名称')
  .max(40, '文件夹名称最长 40 字')

export const createFolderSchema = z.object({
  name: folderNameSchema,
  color: folderColorSchema.nullish(),
  emoji: folderEmojiSchema.nullish(),
})

/** 更新文件夹：字段全部可选，传 null 表示清除颜色/图标。 */
export const updateFolderSchema = z
  .object({
    name: folderNameSchema.optional(),
    color: folderColorSchema.nullable().optional(),
    emoji: folderEmojiSchema.nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有需要更新的内容' })

export type CreateFolderInput = z.infer<typeof createFolderSchema>
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>
