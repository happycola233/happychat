import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'
import { loginSchema, registerSchema } from '@shared/schemas/auth'
import {
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from '@shared/schemas/settings'
import { db } from '../db/client'
import { appSettings, attachments, inviteCodes, userSettings, users } from '../db/schema'
import { hashPassword, verifyPassword } from '../auth/password'
import { createSession, destroyAllUserSessions, destroySession } from '../auth/session'
import { toPublicUser } from '../auth/users'
import { requireUser } from '../auth/middleware'
import { jsonValidator } from '../http/validator'
import { getUserSettings, updateUserSettings } from '../services/settings'
import {
  MAX_AVATAR_BYTES,
  isImageMime,
  mimeFromPath,
  readUpload,
  removeUpload,
  saveUpload,
} from '../storage/files'
import { newId } from '../lib/id'
import type { AppEnv } from '../http/types'

export const authRoutes = new Hono<AppEnv>()

/** 公开注册状态；匿名响应禁止缓存，避免管理员切换策略后注册页继续使用旧值。 */
authRoutes.get('/bootstrap', (c) => {
  const total = db.select({ c: sql<number>`count(*)` }).from(users).get()?.c ?? 0
  const registrationPolicy = db
    .select({ requiresInviteCode: appSettings.registrationRequiresInviteCode })
    .from(appSettings)
    .limit(1)
    .get()
  c.header('Cache-Control', 'no-store')
  return c.json({
    needsBootstrap: total === 0,
    // 老库尚未创建设置单例行时保持既有的“需要邀请码”行为。
    registrationRequiresInviteCode: registrationPolicy?.requiresInviteCode ?? true,
  })
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
    const registrationPolicy = tx
      .select({ requiresInviteCode: appSettings.registrationRequiresInviteCode })
      .from(appSettings)
      .limit(1)
      .get()
    const requiresInviteCode = !isFirst && (registrationPolicy?.requiresInviteCode ?? true)

    if (requiresInviteCode) {
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

/** 重新读取用户行（在更新资料/头像后返回最新 PublicUser）。 */
async function freshPublicUser(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return u ? toPublicUser(u) : null
}

function isUsernameUniqueError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    String(error.message).includes('users.username')
  )
}

// ===================== 设置 =====================

authRoutes.get('/settings', requireUser, async (c) => {
  return c.json({ settings: await getUserSettings(c.get('user').id) })
})

authRoutes.put('/settings', requireUser, jsonValidator(updateSettingsSchema), async (c) => {
  const settings = await updateUserSettings(c.get('user').id, c.req.valid('json'))
  return c.json({ settings })
})

// ===================== 账户 =====================

authRoutes.post('/change-password', requireUser, jsonValidator(changePasswordSchema), async (c) => {
  const user = c.get('user')
  const { currentPassword, newPassword } = c.req.valid('json')
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return c.json({ error: { message: '当前密码不正确', code: 'invalid_password' } }, 400)
  }
  await db.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, user.id))
  // 失效所有会话（含当前），再为当前设备重新签发，使其它设备下线。
  await destroyAllUserSessions(user.id)
  await createSession(c, user.id)
  return c.json({ ok: true })
})

authRoutes.patch('/profile', requireUser, jsonValidator(updateProfileSchema), async (c) => {
  const user = c.get('user')
  const input = c.req.valid('json')
  const username = input.username?.trim()
  const displayName =
    input.displayName === undefined ? user.displayName : input.displayName?.trim() || null

  if (username && username !== user.username) {
    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .get()
    if (existing && existing.id !== user.id) {
      return c.json({ error: { message: '该用户名已被占用', code: 'username_taken' } }, 400)
    }
  }

  try {
    await db
      .update(users)
      .set({ username: username ?? user.username, displayName })
      .where(eq(users.id, user.id))
  } catch (error) {
    // 唯一索引仍是最后防线：避免并发改名时绕过上面的预检查。
    if (isUsernameUniqueError(error)) {
      return c.json({ error: { message: '该用户名已被占用', code: 'username_taken' } }, 400)
    }
    throw error
  }
  return c.json({ user: await freshPublicUser(user.id) })
})

authRoutes.post('/avatar', requireUser, async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) {
    return c.json({ error: { message: '未收到文件', code: 'no_file' } }, 400)
  }
  if (!isImageMime(file.type)) {
    return c.json({ error: { message: '头像需为 PNG/JPEG/WebP/GIF 图片', code: 'bad_type' } }, 400)
  }
  if (file.size === 0) {
    return c.json({ error: { message: '文件为空', code: 'empty' } }, 400)
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return c.json({ error: { message: '头像最大 5MB', code: 'too_large' } }, 400)
  }
  const buf = Buffer.from(await file.arrayBuffer())
  const storagePath = saveUpload(user.id, newId(), file.name || 'avatar', file.type, buf)
  if (user.avatarPath) removeUpload(user.avatarPath)
  await db.update(users).set({ avatarPath: storagePath }).where(eq(users.id, user.id))
  return c.json({ user: await freshPublicUser(user.id) })
})

authRoutes.delete('/avatar', requireUser, async (c) => {
  const user = c.get('user')
  if (user.avatarPath) removeUpload(user.avatarPath)
  await db.update(users).set({ avatarPath: null }).where(eq(users.id, user.id))
  return c.json({ user: await freshPublicUser(user.id) })
})

/** 读取某用户头像（头像非敏感，公开可读：供 UI 与公开分享页复用）。 */
authRoutes.get('/avatar/:id', async (c) => {
  const [u] = await db.select().from(users).where(eq(users.id, c.req.param('id'))).limit(1)
  if (!u?.avatarPath) {
    return c.json({ error: { message: '头像不存在', code: 'not_found' } }, 404)
  }
  try {
    const buf = readUpload(u.avatarPath)
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': mimeFromPath(u.avatarPath),
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return c.json({ error: { message: '头像文件缺失', code: 'file_missing' } }, 404)
  }
})

authRoutes.delete('/account', requireUser, jsonValidator(deleteAccountSchema), async (c) => {
  const user = c.get('user')
  if (!verifyPassword(c.req.valid('json').password, user.passwordHash)) {
    return c.json({ error: { message: '密码不正确', code: 'invalid_password' } }, 400)
  }
  // 末位管理员守卫：系统需保留至少一名管理员。
  if (user.role === 'admin') {
    const adminCount =
      db
        .select({ c: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.role, 'admin'))
        .get()?.c ?? 0
    if (adminCount <= 1) {
      return c.json({ error: { message: '系统需保留至少一名管理员，无法删除', code: 'last_admin' } }, 400)
    }
  }
  // 路径快照和用户级联删除保持在同一事务，避免并发分支复制在快照后落盘而成为孤儿。
  const deletedResources = db.transaction(
    (tx) => {
      const currentUser = tx
        .select({ avatarPath: users.avatarPath })
        .from(users)
        .where(eq(users.id, user.id))
        .get()
      const attachmentRows = tx
        .select({ storagePath: attachments.storagePath })
        .from(attachments)
        .where(eq(attachments.userId, user.id))
        .all()

      // 删除用户会级联清理会话/消息/附件行/设置/会话表行。
      tx.delete(users).where(eq(users.id, user.id)).run()
      return { attachmentRows, avatarPath: currentUser?.avatarPath ?? null }
    },
    { behavior: 'immediate' },
  )
  const attachmentRows = deletedResources.attachmentRows
  for (const attachment of attachmentRows) removeUpload(attachment.storagePath)
  if (deletedResources.avatarPath) removeUpload(deletedResources.avatarPath)
  await destroySession(c)
  return c.json({ ok: true })
})
