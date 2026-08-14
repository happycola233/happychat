import { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../auth/middleware'
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
  // 浏览器传 `-new Date().getTimezoneOffset()`：热力图必须按用户本地日分格。
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
  days: z.coerce.number().int().min(7).max(USAGE_STATS_MAX_DAYS).optional(),
})

/** 个人使用情况面板的数据包（热力图 / 分模型 / 时段分布 / 趋势）。 */
quotaRoutes.get('/usage', async (c) => {
  const parsed = usageQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json({ error: { message: '查询参数有误', code: 'invalid_request' } }, 400)
  }
  const stats = await getMyUsageStats(c.get('user').id, {
    tzOffsetMinutes: parsed.data.tzOffsetMinutes,
    days: parsed.data.days,
  })
  return c.json({ stats })
})
