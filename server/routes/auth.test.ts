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
  const { authRoutes } = await import('./auth')

  app = new Hono<AppEnv>()
  app.route('/api/auth', authRoutes)
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
