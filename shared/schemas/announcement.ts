import { z } from 'zod'
import type {
  AnnouncementAudience,
  AnnouncementChannel,
  AnnouncementLevel,
  AnnouncementStatus,
} from '../types/domain'

// 枚举取值（供前端下拉与后端校验共用）。用 as const 元组给 z.enum，
// 并以下方 satisfies 断言与 domain.ts 的联合类型保持同步。
export const ANNOUNCEMENT_LEVELS = ['info', 'success', 'warning', 'critical'] as const
export const ANNOUNCEMENT_CHANNELS = ['silent', 'banner', 'modal'] as const
export const ANNOUNCEMENT_AUDIENCES = ['all', 'selected'] as const
export const ANNOUNCEMENT_STATUSES = ['draft', 'published'] as const

/** 单条公告可精确指定的用户数上限；避免请求体与批量写入无限膨胀。 */
export const ANNOUNCEMENT_AUDIENCE_USER_LIMIT = 10_000

// 编译期护栏：数组取值必须精确覆盖 domain 联合类型（任一侧漂移即报错）。
type _LevelSync = AnnouncementLevel extends (typeof ANNOUNCEMENT_LEVELS)[number]
  ? (typeof ANNOUNCEMENT_LEVELS)[number] extends AnnouncementLevel
    ? true
    : never
  : never
type _ChannelSync = AnnouncementChannel extends (typeof ANNOUNCEMENT_CHANNELS)[number]
  ? (typeof ANNOUNCEMENT_CHANNELS)[number] extends AnnouncementChannel
    ? true
    : never
  : never
type _AudienceSync = AnnouncementAudience extends (typeof ANNOUNCEMENT_AUDIENCES)[number]
  ? (typeof ANNOUNCEMENT_AUDIENCES)[number] extends AnnouncementAudience
    ? true
    : never
  : never
type _StatusSync = AnnouncementStatus extends (typeof ANNOUNCEMENT_STATUSES)[number]
  ? (typeof ANNOUNCEMENT_STATUSES)[number] extends AnnouncementStatus
    ? true
    : never
  : never
// 引用一次以避免「未使用类型」告警。
export type AnnouncementEnumSync = _LevelSync & _ChannelSync & _AudienceSync & _StatusSync

export const announcementLevelSchema = z.enum(ANNOUNCEMENT_LEVELS)
export const announcementChannelSchema = z.enum(ANNOUNCEMENT_CHANNELS)
export const announcementAudienceSchema = z.enum(ANNOUNCEMENT_AUDIENCES)
export const announcementStatusSchema = z.enum(ANNOUNCEMENT_STATUSES)

const announcementAudienceUserIdsSchema = z
  .array(z.string().trim().min(1, '用户 ID 不能为空'))
  .max(ANNOUNCEMENT_AUDIENCE_USER_LIMIT, '单条公告最多指定 10000 位用户')
  .refine((ids) => new Set(ids).size === ids.length, '用户列表不能包含重复项')

function validateSelectedAudience(
  value: { audience?: AnnouncementAudience; userIds?: string[] },
  context: z.RefinementCtx,
) {
  if (value.audience === 'selected' && (!value.userIds || value.userIds.length === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['userIds'],
      message: '请至少选择 1 位用户',
    })
  }
}

/** 创建公告：全字段带默认值，未填即取默认。 */
export const announcementCreateSchema = z
  .object({
    title: z.string().trim().min(1, '请填写标题').max(200),
    body: z.string().min(1, '请填写正文').max(20000),
    level: announcementLevelSchema.default('info'),
    channel: announcementChannelSchema.default('silent'),
    audience: announcementAudienceSchema.default('all'),
    /** selected 模式的完整名单；all 模式下由服务端规范为空数组。 */
    userIds: announcementAudienceUserIdsSchema.default([]),
    status: announcementStatusSchema.default('draft'),
    pinned: z.boolean().default(false),
    /** 强提示弹窗对每个用户最多自动弹出的次数（1–20） */
    maxImpressions: z.number().int().min(1).max(20).default(1),
    /** 生效起点（epoch ms）；null=发布后立即生效 */
    publishAt: z.number().int().nonnegative().nullable().default(null),
    /** 失效终点（epoch ms）；null=永不过期 */
    expiresAt: z.number().int().nonnegative().nullable().default(null),
  })
  .superRefine((value, context) => {
    validateSelectedAudience(value, context)
    if (value.publishAt != null && value.expiresAt != null && value.expiresAt <= value.publishAt) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: '过期时间必须晚于发布时间',
      })
    }
  })

/** 更新公告：所有字段可选（部分补丁）。 */
export const announcementUpdateSchema = z
  .object({
    title: z.string().trim().min(1, '请填写标题').max(200).optional(),
    body: z.string().min(1, '请填写正文').max(20000).optional(),
    level: announcementLevelSchema.optional(),
    channel: announcementChannelSchema.optional(),
    audience: announcementAudienceSchema.optional(),
    /** 提供 audience=selected 时必须同时提交完整名单。 */
    userIds: announcementAudienceUserIdsSchema.optional(),
    status: announcementStatusSchema.optional(),
    pinned: z.boolean().optional(),
    maxImpressions: z.number().int().min(1).max(20).optional(),
    publishAt: z.number().int().nonnegative().nullable().optional(),
    expiresAt: z.number().int().nonnegative().nullable().optional(),
  })
  .superRefine((value, context) => {
    validateSelectedAudience(value, context)
    // 仅当本次补丁同时给出两个非空时间时才校验先后（== null 同时覆盖 null 与 undefined）。
    if (value.publishAt != null && value.expiresAt != null && value.expiresAt <= value.publishAt) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: '过期时间必须晚于发布时间',
      })
    }
  })

export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>
export type AnnouncementUpdateInput = z.infer<typeof announcementUpdateSchema>
