import { z } from 'zod'

/**
 * 创建/更新分享（同一接口：已有分享时刷新快照与设置）。
 *
 * expiresInDays 语义：
 * - 数字：从现在起 N 天后过期；
 * - null：永久有效；
 * - 'keep' / 缺省：保持现有到期时间不变（更新场景），新建分享时等同永久。
 */
export const createShareSchema = z.object({
  showAvatar: z.boolean().default(true),
  showName: z.boolean().default(true),
  expiresInDays: z
    .union([z.literal('keep'), z.number().int().min(1).max(3650), z.null()])
    .optional(),
  /** 是否包含用户上传的图片/文件；false 时分享页以文字占位显示 */
  includeAttachments: z.boolean().default(true),
  /**
   * 手动选择要包含的消息 id（必须落在同一条分支路径上，可任意取子集）；
   * null / 缺省 = 当前可见分支的全部消息。
   */
  messageIds: z.array(z.string().min(1)).min(1).max(2000).nullable().optional(),
})

export type CreateShareInput = z.infer<typeof createShareSchema>
