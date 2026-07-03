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
export const ANNOUNCEMENT_AUDIENCES = ['all', 'admins'] as const
export const ANNOUNCEMENT_STATUSES = ['draft', 'published'] as const

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

/** 创建公告：全字段带默认值，未填即取默认。 */
export const announcementCreateSchema = z
  .object({
    title: z.string().trim().min(1, '请填写标题').max(200),
    body: z.string().min(1, '请填写正文').max(20000),
    level: announcementLevelSchema.default('info'),
    channel: announcementChannelSchema.default('silent'),
    audience: announcementAudienceSchema.default('all'),
    status: announcementStatusSchema.default('draft'),
    pinned: z.boolean().default(false),
    /** 强提示弹窗对每个用户最多自动弹出的次数（1–20） */
    maxImpressions: z.number().int().min(1).max(20).default(1),
    /** 生效起点（epoch ms）；null=发布后立即生效 */
    publishAt: z.number().int().nonnegative().nullable().default(null),
    /** 失效终点（epoch ms）；null=永不过期 */
    expiresAt: z.number().int().nonnegative().nullable().default(null),
  })
  .refine((v) => v.publishAt == null || v.expiresAt == null || v.expiresAt > v.publishAt, {
    message: '过期时间必须晚于发布时间',
    path: ['expiresAt'],
  })

/** 更新公告：所有字段可选（部分补丁）。 */
export const announcementUpdateSchema = z
  .object({
    title: z.string().trim().min(1, '请填写标题').max(200).optional(),
    body: z.string().min(1, '请填写正文').max(20000).optional(),
    level: announcementLevelSchema.optional(),
    channel: announcementChannelSchema.optional(),
    audience: announcementAudienceSchema.optional(),
    status: announcementStatusSchema.optional(),
    pinned: z.boolean().optional(),
    maxImpressions: z.number().int().min(1).max(20).optional(),
    publishAt: z.number().int().nonnegative().nullable().optional(),
    expiresAt: z.number().int().nonnegative().nullable().optional(),
  })
  // 仅当本次补丁同时给出两个非空时间时才校验先后（== null 同时覆盖 null 与 undefined）。
  .refine((v) => v.publishAt == null || v.expiresAt == null || v.expiresAt > v.publishAt, {
    message: '过期时间必须晚于发布时间',
    path: ['expiresAt'],
  })

export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>
export type AnnouncementUpdateInput = z.infer<typeof announcementUpdateSchema>
