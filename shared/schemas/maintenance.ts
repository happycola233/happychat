import { z } from 'zod'

/** 维护期间拒绝业务请求时返回的错误码（HTTP 503）；前端据此切换到维护页。 */
export const MAINTENANCE_ERROR_CODE = 'maintenance'

export const MAINTENANCE_LANGUAGES = ['zh', 'en', 'both'] as const
export type MaintenanceLanguage = (typeof MAINTENANCE_LANGUAGES)[number]

/** 空白补充说明统一存为 null：维护页只显示内置文案。 */
const maintenanceNoteSchema = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((value) => value || null)

/** 维护页向访客展示的内容。 */
export const maintenanceNoticeSchema = z.object({
  language: z.enum(MAINTENANCE_LANGUAGES),
  noteZh: maintenanceNoteSchema,
  noteEn: maintenanceNoteSchema,
  /** 预计恢复时间（毫秒时间戳）；仅用于展示，到点不会自动结束维护。 */
  expectedEndAt: z.number().int().positive().nullable(),
})

export const maintenanceConfigSchema = maintenanceNoticeSchema.extend({
  enabled: z.boolean(),
})

export type MaintenanceNotice = z.infer<typeof maintenanceNoticeSchema>
export type MaintenanceConfig = z.infer<typeof maintenanceConfigSchema>

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  enabled: false,
  language: 'zh',
  noteZh: null,
  noteEn: null,
  expectedEndAt: null,
}
