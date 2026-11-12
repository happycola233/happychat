import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfigDTO, MaintenanceStatusDTO } from '@shared/types/api'
import type { AppEnv } from '../http/types'

let temporaryDirectory: string
let app: Hono<AppEnv>
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let adminCookie: string
let userCookie: string

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'happychat-maintenance-routes-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-maintenance-routes'

  // 数据库客户端读取环境变量并维持模块级单例；先重置模块，再按真实启动顺序迁移并挂载路由。
  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  migration.runMigrations()
  const [{ authRoutes }, { adminRoutes }, { maintenanceRoutes }, { folderRoutes }] =
    await Promise.all([
      import('./auth'),
      import('./admin'),
      import('./maintenance'),
      import('./folders'),
    ])

  app = new Hono<AppEnv>()
  app.route('/api/maintenance', maintenanceRoutes)
  app.route('/api/auth', authRoutes)
  app.route('/api/admin', adminRoutes)
  app.route('/api/folders', folderRoutes)
})

beforeEach(async () => {
  dbClient.sqlite.exec(`
    DELETE FROM invite_codes;
    DELETE FROM users;
    DELETE FROM app_settings;
  `)
  // 首位注册者成为管理员；随后放开邀请码要求，再注册一位普通用户。
  adminCookie = await registerAndGetCookie('owner')
  await patchConfig({ registrationRequiresInviteCode: false })
  userCookie = await registerAndGetCookie('member')
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function registerAndGetCookie(username: string): Promise<string> {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123' }),
  })
  expect(response.status).toBe(200)
  return response.headers.get('set-cookie')!.split(';', 1)[0]!
}

async function patchConfig(body: unknown): Promise<AppConfigDTO> {
  const response = await app.request('/api/admin/app-config', {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as { config: AppConfigDTO }).config
}

async function publicStatus(): Promise<MaintenanceStatusDTO> {
  const response = await app.request('/api/maintenance')
  expect(response.headers.get('cache-control')).toBe('no-store')
  return (await response.json()) as MaintenanceStatusDTO
}

const getAs = (path: string, cookie: string) => app.request(path, { headers: { Cookie: cookie } })

describe('维护模式', () => {
  it('默认关闭：公开状态为空，普通用户照常访问', async () => {
    expect(await publicStatus()).toEqual({ notice: null })
    expect((await getAs('/api/folders', userCookie)).status).toBe(200)
  })

  it('开启后拦截普通用户的业务请求，管理员、登录态查询与登录不受影响', async () => {
    await patchConfig({ maintenance: { enabled: true } })

    const blocked = await getAs('/api/folders', userCookie)
    expect(blocked.status).toBe(503)
    expect(await blocked.json()).toMatchObject({ error: { code: 'maintenance' } })

    expect((await getAs('/api/folders', adminCookie)).status).toBe(200)
    expect((await getAs('/api/auth/me', userCookie)).status).toBe(200)
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'member', password: 'password123' }),
    })
    expect(login.status).toBe(200)
  })

  it('公开状态只返回维护页内容，关闭后恢复访问', async () => {
    const expectedEndAt = Date.now() + 3_600_000
    await patchConfig({
      maintenance: { language: 'both', noteZh: '  正在升级模型线路  ', noteEn: '', expectedEndAt },
    })
    // 只改内容不会开启维护。
    expect(await publicStatus()).toEqual({ notice: null })

    await patchConfig({ maintenance: { enabled: true } })
    expect(await publicStatus()).toEqual({
      notice: { language: 'both', noteZh: '正在升级模型线路', noteEn: null, expectedEndAt },
    })

    // 只切换开关不会丢失已保存的内容。
    const config = await patchConfig({ maintenance: { enabled: false } })
    expect(config.maintenance).toEqual({
      enabled: false,
      language: 'both',
      noteZh: '正在升级模型线路',
      noteEn: null,
      expectedEndAt,
    })
    expect(await publicStatus()).toEqual({ notice: null })
    expect((await getAs('/api/folders', userCookie)).status).toBe(200)
  })

  it('旧库没有维护设置时返回默认值', async () => {
    dbClient.db.update(schema.appSettings).set({ maintenance: null }).run()
    const response = await getAs('/api/admin/app-config', adminCookie)
    const { config } = (await response.json()) as { config: AppConfigDTO }
    expect(config.maintenance).toEqual({
      enabled: false,
      language: 'zh',
      noteZh: null,
      noteEn: null,
      expectedEndAt: null,
    })
  })
})
