import { Hono } from 'hono'
import { requireUser } from '../auth/middleware'
import { listEnabledModels } from '../services/models'
import type { AppEnv } from '../http/types'

export const modelRoutes = new Hono<AppEnv>()

modelRoutes.use('*', requireUser)

/** 用户可见的已启用模型列表（含能力标记，用于选择器与控件门控） */
modelRoutes.get('/', async (c) => {
  return c.json({ models: await listEnabledModels() })
})
