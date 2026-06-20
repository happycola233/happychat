import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { eq } from 'drizzle-orm'
import { SESSION_COOKIE, SESSION_TTL_MS } from '@shared/constants'
import { db } from '../db/client'
import { sessions, users } from '../db/schema'
import { env } from '../env'
import type { AuthUser } from '../http/types'

const cookieOptions = () =>
  ({
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }) as const

export async function createSession(c: Context, userId: string): Promise<void> {
  const userAgent = c.req.header('user-agent') ?? null
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const rows = await db.insert(sessions).values({ userId, userAgent, expiresAt }).returning()
  const row = rows[0]
  if (!row) throw new Error('创建会话失败')
  await setSignedCookie(c, SESSION_COOKIE, row.id, env.SESSION_SECRET, cookieOptions())
}

export async function destroySession(c: Context): Promise<void> {
  const sid = await getSignedCookie(c, env.SESSION_SECRET, SESSION_COOKIE)
  if (sid) await db.delete(sessions).where(eq(sessions.id, sid))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

/** 失效某用户的全部会话（改密码 / 删除账户时强制其它设备下线）。 */
export async function destroyAllUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

/** 从签名 cookie 解析当前登录用户；无效/过期返回 null（并清理过期会话）。 */
export async function getAuthUser(c: Context): Promise<AuthUser | null> {
  const sid = await getSignedCookie(c, env.SESSION_SECRET, SESSION_COOKIE)
  if (!sid) return null
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1)
  if (!s) return null
  if (s.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sid))
    return null
  }
  const [u] = await db.select().from(users).where(eq(users.id, s.userId)).limit(1)
  if (!u || u.disabled) return null
  return u
}
