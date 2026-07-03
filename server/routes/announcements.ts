import { Hono } from 'hono'
import { requireUser } from '../auth/middleware'
import {
  listActiveForUser,
  markAllAnnouncementsRead,
  markAnnouncementRead,
  recordAnnouncementImpression,
} from '../services/announcements'
import type { AppEnv } from '../http/types'

// 用户端公告接口（全部需登录）。可见性/已读均按当前用户计算。
export const announcementRoutes = new Hono<AppEnv>()

announcementRoutes.use('*', requireUser)

/** 当前对该用户生效的公告列表（含是否已读）。 */
announcementRoutes.get('/active', async (c) => {
  return c.json({ announcements: await listActiveForUser(c.get('user')) })
})

/** 标记单条已读（幂等）。 */
announcementRoutes.post('/:id/read', async (c) => {
  const ok = await markAnnouncementRead(c.req.param('id'), c.get('user').id)
  if (!ok) return c.json({ error: { message: '公告不存在', code: 'not_found' } }, 404)
  return c.json({ ok: true })
})

/** 记录一次强弹窗曝光（幂等 +1）。 */
announcementRoutes.post('/:id/impression', async (c) => {
  const ok = await recordAnnouncementImpression(c.req.param('id'), c.get('user').id)
  if (!ok) return c.json({ error: { message: '公告不存在', code: 'not_found' } }, 404)
  return c.json({ ok: true })
})

/** 全部标记已读（幂等）；返回本次新标记条数。 */
announcementRoutes.post('/read-all', async (c) => {
  const marked = await markAllAnnouncementsRead(c.get('user'))
  return c.json({ ok: true, marked })
})
