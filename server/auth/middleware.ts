import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import type { AppEnv, AuthUser } from '../http/types'
import { getAuthUser } from './session'

async function authenticate(c: Context<AppEnv>): Promise<AuthUser | null> {
  const user = await getAuthUser(c)
  if (user) c.set('user', user)
  return user
}

const unauthorized = (c: Context<AppEnv>) =>
  c.json({ error: { message: '请先登录', code: 'unauthorized' } }, 401)

const passwordChangeRequired = (c: Context<AppEnv>) =>
  c.json({ error: { message: '请先设置新密码', code: 'password_change_required' } }, 403)

/** 只确认登录态；仅供 /me 与完成强制改密接口使用。 */
export const requireAuthenticatedUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await authenticate(c))) return unauthorized(c)
  await next()
})

/** 完整业务会话：临时密码登录者会在服务端被强制限制到改密流程。 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await authenticate(c)
  if (!user) return unauthorized(c)
  if (user.mustChangePassword) return passwordChangeRequired(c)
  await next()
})

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = await authenticate(c)
  if (!user) return unauthorized(c)
  if (user.mustChangePassword) return passwordChangeRequired(c)
  if (user.role !== 'admin') {
    return c.json({ error: { message: '需要管理员权限', code: 'forbidden' } }, 403)
  }
  await next()
})
