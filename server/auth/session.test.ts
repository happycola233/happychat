import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let temporaryDirectory: string
let app: Hono
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'happychat-session-ip-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-client-ip'
  process.env.CLIENT_IP_HEADER = 'x-client-ip'
  process.env.TRUSTED_PROXY_HOPS = '0'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  migration.runMigrations()
  const { createSession, getAuthUser } = await import('./session')

  app = new Hono()
  app.post('/sessions/:userId', async (c) => {
    await createSession(c, c.req.param('userId'))
    return c.json({ ok: true })
  })
  app.get('/me', async (c) => {
    const user = await getAuthUser(c)
    return c.json({ userId: user?.id ?? null })
  })
})

beforeEach(() => {
  dbClient.sqlite.exec('DELETE FROM users;')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

function responseCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('测试响应没有签发会话 cookie')
  return setCookie.split(';', 1)[0]!
}

async function readOnlySession() {
  const rows = await dbClient.db.select().from(schema.sessions)
  expect(rows).toHaveLength(1)
  return rows[0]!
}

describe('会话 IP 记录', () => {
  it('记录登录 IP，并仅在 IP 变化或超过五分钟时刷新最近活动', async () => {
    const [user] = await dbClient.db
      .insert(schema.users)
      .values({ username: 'session-ip-user', passwordHash: 'test-hash' })
      .returning()
    if (!user) throw new Error('创建测试用户失败')

    const loginResponse = await app.request(`/sessions/${user.id}`, {
      method: 'POST',
      headers: { 'x-client-ip': '203.0.113.50', 'user-agent': 'HappyChat Session Test' },
    })
    expect(loginResponse.status).toBe(200)
    const cookie = responseCookie(loginResponse)

    const createdSession = await readOnlySession()
    expect(createdSession).toMatchObject({
      loginIp: '203.0.113.50',
      lastSeenIp: null,
      lastSeenAt: null,
      userAgent: 'HappyChat Session Test',
    })

    const firstActivity = await app.request('/me', {
      headers: { Cookie: cookie, 'x-client-ip': '203.0.113.50' },
    })
    expect(firstActivity.status).toBe(200)
    const firstSeenAt = (await readOnlySession()).lastSeenAt
    expect(firstSeenAt?.getTime()).toBe(Date.now())

    vi.advanceTimersByTime(4 * 60 * 1000)
    await app.request('/me', {
      headers: { Cookie: cookie, 'x-client-ip': '203.0.113.50' },
    })
    expect((await readOnlySession()).lastSeenAt?.getTime()).toBe(firstSeenAt?.getTime())

    await app.request('/me', {
      headers: { Cookie: cookie, 'x-client-ip': '198.51.100.60' },
    })
    const changedIpSession = await readOnlySession()
    expect(changedIpSession.lastSeenIp).toBe('198.51.100.60')
    expect(changedIpSession.lastSeenAt?.getTime()).toBe(Date.now())

    const changedAt = changedIpSession.lastSeenAt
    vi.advanceTimersByTime(5 * 60 * 1000)
    await app.request('/me', {
      headers: { Cookie: cookie, 'x-client-ip': '198.51.100.60' },
    })
    expect((await readOnlySession()).lastSeenAt?.getTime()).toBe(changedAt?.getTime())

    vi.advanceTimersByTime(1)
    await app.request('/me', {
      headers: { Cookie: cookie, 'x-client-ip': '198.51.100.60' },
    })
    expect((await readOnlySession()).lastSeenAt?.getTime()).toBe(Date.now())
  })

  it('无法解析 IP 时不写占位值，也不清空最近已知地址', async () => {
    const [user] = await dbClient.db
      .insert(schema.users)
      .values({ username: 'session-null-ip-user', passwordHash: 'test-hash' })
      .returning()
    if (!user) throw new Error('创建测试用户失败')

    const loginResponse = await app.request(`/sessions/${user.id}`, {
      method: 'POST',
      headers: { 'x-client-ip': '203.0.113.70' },
    })
    const cookie = responseCookie(loginResponse)
    await app.request('/me', {
      headers: { Cookie: cookie, 'x-client-ip': '203.0.113.70' },
    })
    const knownSession = await readOnlySession()

    vi.advanceTimersByTime(6 * 60 * 1000)
    await app.request('/me', { headers: { Cookie: cookie, 'x-client-ip': 'not-an-ip' } })

    const unresolvedSession = await readOnlySession()
    expect(unresolvedSession.lastSeenIp).toBe('203.0.113.70')
    expect(unresolvedSession.lastSeenAt?.getTime()).toBe(knownSession.lastSeenAt?.getTime())
  })
})
