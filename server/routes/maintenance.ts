import { Hono } from 'hono'
import type { MaintenanceStatusDTO } from '@shared/types/api'
import type { AppEnv } from '../http/types'
import { getActiveMaintenanceNotice } from '../services/appConfig'

export const maintenanceRoutes = new Hono<AppEnv>()

/** 公开的维护状态：未登录的访客也要能看到维护页。禁止缓存，结束维护后立即恢复访问。 */
maintenanceRoutes.get('/', async (c) => {
  c.header('Cache-Control', 'no-store')
  const status: MaintenanceStatusDTO = { notice: await getActiveMaintenanceNotice() }
  return c.json(status)
})
