import { Hono } from 'hono'
import { requireUser } from '../auth/middleware'
import { listVisibleModelGroups } from '../services/model-groups'
import { listEnabledModels } from '../services/models'
import type { AppEnv } from '../http/types'

export const modelRoutes = new Hono<AppEnv>()

modelRoutes.use('*', requireUser)

/**
 * 用户可见的已启用模型列表（含能力标记，用于选择器与控件门控）。
 * 分组随同一响应返回：两者在选择器里必须同时到达，拆成两个查询会出现
 * 「模型已渲染、分组还没到」的一帧无分组闪烁。
 */
modelRoutes.get('/', async (c) => {
  const userId = c.get('user').id
  const [models, groups] = await Promise.all([
    listEnabledModels(userId),
    listVisibleModelGroups(userId),
  ])
  return c.json({ models, groups })
})
