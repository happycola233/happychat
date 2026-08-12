import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapStatus } from '@shared/types/api'
import type { AppEnv } from '../http/types'

let temporaryDirectory: string
let app: Hono<AppEnv>
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let appConfigService: typeof import('../services/appConfig')

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'happychat-auth-routes-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-auth-routes'

  // 数据库客户端读取环境变量并维持模块级单例；先重置模块，再按真实启动顺序迁移并挂载路由。
  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  migration.runMigrations()
  appConfigService = await import('../services/appConfig')
  const [{ authRoutes }, { adminRoutes }] = await Promise.all([import('./auth'), import('./admin')])

  app = new Hono<AppEnv>()
  app.route('/api/auth', authRoutes)
  app.route('/api/admin', adminRoutes)
})

beforeEach(() => {
  // users 会级联清理 session/user_settings；邀请码先删，避免 created_by 被改写后留下测试数据。
  dbClient.sqlite.exec(`
    DELETE FROM invite_codes;
    DELETE FROM users;
    DELETE FROM app_settings;
  `)
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function bootstrap(): Promise<{ response: Response; payload: BootstrapStatus }> {
  const response = await app.request('/api/auth/bootstrap')
  const payload = (await response.json()) as BootstrapStatus
  return { response, payload }
}

async function register(input: { username: string; password?: string; inviteCode?: string }) {
  return app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'password123', ...input }),
  })
}

function responseCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('测试响应没有签发会话 cookie')
  return setCookie.split(';', 1)[0]!
}

async function login(username: string, password: string) {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

function authenticatedRequest(path: string, cookie: string, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
}

async function createFirstAdmin(username = 'owner') {
  const response = await register({ username })
  expect(response.status).toBe(200)
  const payload = (await response.json()) as {
    user: { id: string; username: string; role: 'admin' | 'user' }
  }
  expect(payload.user).toMatchObject({ username, role: 'admin' })
  return payload.user
}

async function createInvite(code: string, maxUses = 1) {
  const [invite] = await dbClient.db
    .insert(schema.inviteCodes)
    .values({ code, maxUses })
    .returning()
  if (!invite) throw new Error('创建测试邀请码失败')
  return invite
}

async function readInvite(code: string) {
  const [invite] = await dbClient.db
    .select()
    .from(schema.inviteCodes)
    .where(eq(schema.inviteCodes.code, code))
    .limit(1)
  return invite
}

describe('注册邀请码策略', () => {
  it('首位用户无需邀请码并成为管理员，bootstrap 同时返回首装状态与原始默认策略', async () => {
    const initial = await bootstrap()
    expect(initial.response.status).toBe(200)
    expect(initial.response.headers.get('Cache-Control')).toBe('no-store')
    expect(initial.payload).toEqual({
      needsBootstrap: true,
      registrationRequiresInviteCode: true,
    })

    const admin = await createFirstAdmin()
    const [settings] = await dbClient.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, admin.id))
      .limit(1)
    expect(settings).toBeDefined()

    const initialized = await bootstrap()
    expect(initialized.payload).toEqual({
      needsBootstrap: false,
      registrationRequiresInviteCode: true,
    })
  })

  it('默认开启时，非首位用户缺少邀请码或只传空白均由业务规则拒绝', async () => {
    await createFirstAdmin()

    for (const [username, inviteCode] of [
      ['missing-invite', undefined],
      ['blank-invite', '   '],
    ] as const) {
      const response = await register({ username, inviteCode })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: { message: '注册需要邀请码', code: 'register_failed' },
      })
    }

    const allUsers = await dbClient.db.select().from(schema.users)
    expect(allUsers).toHaveLength(1)
  })

  it('关闭策略后允许无邀请码注册，并忽略随附的有效邀请码而不消耗次数', async () => {
    await createFirstAdmin()
    await appConfigService.updateAppConfig({ registrationRequiresInviteCode: false })
    const inviteCode = 'OPEN-REGISTRATION-CODE'
    await createInvite(inviteCode, 2)

    const openBootstrap = await bootstrap()
    expect(openBootstrap.payload).toEqual({
      needsBootstrap: false,
      registrationRequiresInviteCode: false,
    })

    const withoutInvite = await register({ username: 'open-user' })
    expect(withoutInvite.status).toBe(200)
    await expect(withoutInvite.json()).resolves.toMatchObject({
      user: { username: 'open-user', role: 'user' },
    })

    const withInvite = await register({ username: 'open-user-with-code', inviteCode })
    expect(withInvite.status).toBe(200)
    await expect(withInvite.json()).resolves.toMatchObject({
      user: { username: 'open-user-with-code', role: 'user' },
    })
    expect((await readInvite(inviteCode))?.usedCount).toBe(0)
  })

  it('策略关闭后重新开启会立即恢复校验，并在成功注册时消耗邀请码', async () => {
    await createFirstAdmin()
    await appConfigService.updateAppConfig({ registrationRequiresInviteCode: false })
    await appConfigService.updateAppConfig({ registrationRequiresInviteCode: true })
    const inviteCode = 'REOPENED-REGISTRATION-CODE'
    await createInvite(inviteCode)

    const reopenedBootstrap = await bootstrap()
    expect(reopenedBootstrap.payload).toEqual({
      needsBootstrap: false,
      registrationRequiresInviteCode: true,
    })

    const rejectedWithoutInvite = await register({ username: 'reopened-without-code' })
    expect(rejectedWithoutInvite.status).toBe(400)
    await expect(rejectedWithoutInvite.json()).resolves.toMatchObject({
      error: { message: '注册需要邀请码' },
    })

    const response = await register({ username: 'invited-user', inviteCode })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      user: { username: 'invited-user', role: 'user' },
    })
    expect((await readInvite(inviteCode))?.usedCount).toBe(1)
  })
})

describe('管理员重置密码与强制改密', () => {
  it('撤销旧会话，只允许临时密码会话完成改密，之后恢复正常访问', async () => {
    const adminRegistration = await register({ username: 'owner' })
    expect(adminRegistration.status).toBe(200)
    const adminCookie = responseCookie(adminRegistration)
    const adminPayload = (await adminRegistration.json()) as { user: { id: string } }

    await appConfigService.updateAppConfig({ registrationRequiresInviteCode: false })
    const userRegistration = await register({
      username: 'forgotten-user',
      password: 'old-password',
    })
    expect(userRegistration.status).toBe(200)
    const oldUserCookie = responseCookie(userRegistration)
    const userPayload = (await userRegistration.json()) as {
      user: { id: string; mustChangePassword: boolean }
    }
    expect(userPayload.user.mustChangePassword).toBe(false)

    const resetResponse = await authenticatedRequest(
      `/api/admin/users/${userPayload.user.id}/reset-password`,
      adminCookie,
      { method: 'POST' },
    )
    expect(resetResponse.status).toBe(200)
    expect(resetResponse.headers.get('Cache-Control')).toBe('no-store')
    const resetPayload = (await resetResponse.json()) as { temporaryPassword: string }
    const groups = resetPayload.temporaryPassword.split('-')
    expect(groups).toHaveLength(4)
    expect(groups.every((group) => group.length === 4)).toBe(true)
    expect(resetPayload.temporaryPassword).toMatch(/^[A-Za-z2-9-]+$/)

    // 管理员不能借此接口绕过自己的“输入当前密码”改密流程。
    const selfReset = await authenticatedRequest(
      `/api/admin/users/${adminPayload.user.id}/reset-password`,
      adminCookie,
      { method: 'POST' },
    )
    expect(selfReset.status).toBe(400)

    // 重置与旧会话撤销必须是同一个原子结果。
    const oldSession = await authenticatedRequest('/api/auth/me', oldUserCookie)
    expect(oldSession.status).toBe(401)
    expect((await login('forgotten-user', 'old-password')).status).toBe(401)

    const temporaryLogin = await login('forgotten-user', resetPayload.temporaryPassword)
    expect(temporaryLogin.status).toBe(200)
    const temporaryCookie = responseCookie(temporaryLogin)
    await expect(temporaryLogin.json()).resolves.toMatchObject({
      user: { mustChangePassword: true },
    })

    const meDuringReset = await authenticatedRequest('/api/auth/me', temporaryCookie)
    expect(meDuringReset.status).toBe(200)
    await expect(meDuringReset.json()).resolves.toMatchObject({
      user: { mustChangePassword: true },
    })

    const blockedSettings = await authenticatedRequest('/api/auth/settings', temporaryCookie)
    expect(blockedSettings.status).toBe(403)
    await expect(blockedSettings.json()).resolves.toEqual({
      error: { message: '请先设置新密码', code: 'password_change_required' },
    })

    const reusedTemporaryPassword = await authenticatedRequest(
      '/api/auth/complete-password-reset',
      temporaryCookie,
      {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPayload.temporaryPassword }),
      },
    )
    expect(reusedTemporaryPassword.status).toBe(400)
    await expect(reusedTemporaryPassword.json()).resolves.toMatchObject({
      error: { code: 'password_reused' },
    })

    const newPassword = 'a-new-permanent-password'
    const completed = await authenticatedRequest(
      '/api/auth/complete-password-reset',
      temporaryCookie,
      {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      },
    )
    expect(completed.status).toBe(200)
    const fullSessionCookie = responseCookie(completed)
    await expect(completed.json()).resolves.toMatchObject({
      user: { mustChangePassword: false },
    })

    // 完成改密会再次轮换会话；临时凭据与临时会话都不能继续使用。
    expect((await authenticatedRequest('/api/auth/me', temporaryCookie)).status).toBe(401)
    expect((await login('forgotten-user', resetPayload.temporaryPassword)).status).toBe(401)
    expect((await authenticatedRequest('/api/auth/settings', fullSessionCookie)).status).toBe(200)
    expect((await login('forgotten-user', newPassword)).status).toBe(200)

    const [storedUser] = await dbClient.db
      .select({ mustChangePassword: schema.users.mustChangePassword })
      .from(schema.users)
      .where(eq(schema.users.id, userPayload.user.id))
      .limit(1)
    expect(storedUser?.mustChangePassword).toBe(false)
  })
})
