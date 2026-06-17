import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../http/types'
import { getAuthUser } from './session'

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await getAuthUser(c)
  if (!user) return c.json({ error: { message: '请先登录', code: 'unauthorized' } }, 401)
  c.set('user', user)
  await next()
})

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = await getAuthUser(c)
  if (!user) return c.json({ error: { message: '请先登录', code: 'unauthorized' } }, 401)
  if (user.role !== 'admin') {
    return c.json({ error: { message: '需要管理员权限', code: 'forbidden' } }, 403)
  }
  c.set('user', user)
  await next()
})
