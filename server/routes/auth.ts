import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { loginSchema, registerSchema } from '@shared/schemas/auth'
import { db } from '../db/client'
import { inviteCodes, userSettings, users } from '../db/schema'
import { hashPassword, verifyPassword } from '../auth/password'
import { createSession, destroySession } from '../auth/session'
import { toPublicUser } from '../auth/users'
import { requireUser } from '../auth/middleware'
import { jsonValidator } from '../http/validator'
import type { AppEnv } from '../http/types'

export const authRoutes = new Hono<AppEnv>()

/** 是否需要初始化（无任何用户时，首位注册者免邀请码并成为管理员） */
authRoutes.get('/bootstrap', (c) => {
  const total = db.select({ c: sql<number>`count(*)` }).from(users).get()?.c ?? 0
  return c.json({ needsBootstrap: total === 0 })
})

authRoutes.post('/register', jsonValidator(registerSchema), async (c) => {
  const { username, password, inviteCode } = c.req.valid('json')
  const passwordHash = hashPassword(password)

  // 在单事务内完成：查重 → 校验/兑换邀请码 → 创建用户与设置，保证原子性。
  const outcome = db.transaction((tx) => {
    const existing = tx.select().from(users).where(eq(users.username, username)).get()
    if (existing) return { error: '该用户名已被占用' } as const

    const total = tx.select({ c: sql<number>`count(*)` }).from(users).get()?.c ?? 0
    const isFirst = total === 0

    if (!isFirst) {
      if (!inviteCode) return { error: '注册需要邀请码' } as const
      const code = tx.select().from(inviteCodes).where(eq(inviteCodes.code, inviteCode)).get()
      if (!code) return { error: '邀请码无效' } as const
      if (code.disabled) return { error: '邀请码已停用' } as const
      if (code.expiresAt && code.expiresAt.getTime() < Date.now()) {
        return { error: '邀请码已过期' } as const
      }
      if (code.usedCount >= code.maxUses) return { error: '邀请码使用次数已用完' } as const
      tx.update(inviteCodes)
        .set({ usedCount: code.usedCount + 1 })
        .where(eq(inviteCodes.id, code.id))
        .run()
    }

    const role = isFirst ? 'admin' : 'user'
    const created = tx.insert(users).values({ username, passwordHash, role }).returning().get()
    if (!created) return { error: '创建用户失败' } as const
    tx.insert(userSettings).values({ userId: created.id }).run()
    return { user: created } as const
  })

  if ('error' in outcome) {
    return c.json({ error: { message: outcome.error, code: 'register_failed' } }, 400)
  }
  await createSession(c, outcome.user.id)
  return c.json({ user: toPublicUser(outcome.user) })
})

authRoutes.post('/login', jsonValidator(loginSchema), async (c) => {
  const { username, password } = c.req.valid('json')
  const [u] = await db.select().from(users).where(eq(users.username, username)).limit(1)
  if (!u || !verifyPassword(password, u.passwordHash)) {
    return c.json({ error: { message: '用户名或密码错误', code: 'invalid_credentials' } }, 401)
  }
  if (u.disabled) {
    return c.json({ error: { message: '该账号已被禁用', code: 'account_disabled' } }, 403)
  }
  await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, u.id))
  await createSession(c, u.id)
  return c.json({ user: toPublicUser(u) })
})

authRoutes.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

authRoutes.get('/me', requireUser, (c) => {
  return c.json({ user: toPublicUser(c.get('user')) })
})
