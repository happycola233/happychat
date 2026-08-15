import { Hono } from 'hono'
import { z } from 'zod'
import { timezoneSchema } from '@shared/schemas/app-config'
import { requireUser } from '../auth/middleware'
import { getAppConfig } from '../services/appConfig'
import { getMyQuota } from '../services/quota'
import { USAGE_STATS_MAX_DAYS, getMyUsageStats } from '../services/usage-stats'
import type { AppEnv } from '../http/types'

export const quotaRoutes = new Hono<AppEnv>()

quotaRoutes.use('*', requireUser)

/**
 * 当前用户的额度视图。全局关闭限额时只返回 `enabled:false`，
 * 不携带任何额度数字——用户端因此完全看不到限额的存在（配置与计数仍在库里）。
 */
quotaRoutes.get('/me', async (c) => {
  return c.json({ quota: await getMyQuota(c.get('user').id) })
})

const usageQuerySchema = z.object({
  // 新客户端传 IANA 时区，服务端才能按每条历史记录发生时的 DST 偏移分桶。
  timezone: timezoneSchema.optional(),
  // 兼容旧客户端；没有 IANA 时区时才退回这个固定偏移。
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
  days: z.coerce.number().int().min(7).max(USAGE_STATS_MAX_DAYS).optional(),
  /** 窗口视图；默认本月。 */
  view: z.enum(['day', 'week', 'month', 'year']).default('month'),
})

/** 个人使用情况面板的数据包（窗口指标 / 趋势 / 分模型 / 热力图）。 */
quotaRoutes.get('/usage', async (c) => {
  const parsed = usageQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json({ error: { message: '查询参数有误', code: 'invalid_request' } }, 400)
  }
  // 「本周」的起点沿用站点限额配置，让个人面板与额度周期是同一个周一/周日。
  const config = await getAppConfig()
  const stats = await getMyUsageStats(c.get('user').id, {
    timezone: parsed.data.timezone,
    tzOffsetMinutes: parsed.data.tzOffsetMinutes,
    days: parsed.data.days,
    view: parsed.data.view,
    weekStart: config.quotaWeekStart,
  })
  return c.json({ stats })
})
