import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import type { AppEnv, AuthUser } from '../http/types'
import { MAINTENANCE_ERROR_CODE } from '@shared/schemas/maintenance'
import { getActiveMaintenanceNotice } from '../services/appConfig'
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

/**
 * 完整业务会话：临时密码登录者会在服务端被强制限制到改密流程。
 * 维护期间只放行管理员，其余账号的业务请求一律返回 503；
 * 登录、登出、读取自身账号与公开分享不经过这里，维护期间照常可用。
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await authenticate(c)
  if (!user) return unauthorized(c)
  if (user.mustChangePassword) return passwordChangeRequired(c)
  if (user.role !== 'admin' && (await getActiveMaintenanceNotice())) {
    return c.json(
      { error: { message: '网站正在维护，请稍后再来', code: MAINTENANCE_ERROR_CODE } },
      503,
    )
  }
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
