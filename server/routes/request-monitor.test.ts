import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { AppEnv } from '../http/types'

let directory: string
let app: Hono<AppEnv>
let client: typeof import('../db/client')
let monitor: typeof import('../services/request-monitor-events')
let adminCookie: string
let userCookie: string

beforeAll(async () => {
  mkdirSync('.tmp', { recursive: true })
  directory = mkdtempSync(join(process.cwd(), '.tmp', 'request-monitor-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = directory
  process.env.DATABASE_URL = join(directory, 'test.db')
  process.env.SESSION_SECRET = 'test-session-secret-request-monitor'
  vi.resetModules()
  client = await import('../db/client')
  const { users } = await import('../db/schema')
  const { runMigrations } = await import('../db/migrate')
  runMigrations()
  const { adminRoutes } = await import('./admin')
  const { createSession } = await import('../auth/session')
  monitor = await import('../services/request-monitor-events')
  app = new Hono<AppEnv>()
  app.route('/api/admin', adminRoutes)
  for (const role of ['admin', 'user'] as const) {
    client.db.insert(users).values({ id: role, username: role, role, passwordHash: 'hash' }).run()
    const login = new Hono()
    login.get('/', async (c) => {
      await createSession(c, role)
      return c.body(null, 204)
    })
    const response = await login.request('/')
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    if (role === 'admin') adminCookie = cookie
    else userCookie = cookie
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
afterAll(() => {
  client?.sqlite.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function connect() {
  const response = await app.request('/api/admin/request-events/stream', {
    headers: { cookie: adminCookie },
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  expect(response.headers.get('x-accel-buffering')).toBe('no')
  const reader = response.body!.getReader()
  onTestFinished(() => reader.cancel())
  const read = async () => new TextDecoder().decode((await reader.read()).value)
  expect(await read()).toBe('event: change\ndata: {}\n\n')
  return { reader, read }
}

describe('管理员请求状态通知', () => {
  it('拒绝未登录用户与普通用户订阅', async () => {
    expect((await app.request('/api/admin/request-events/stream')).status).toBe(401)
    expect(
      (await app.request('/api/admin/request-events/stream', { headers: { cookie: userCookie } }))
        .status,
    ).toBe(403)
  })

  it('连接即补刷，状态变化立即通知，事件不包含请求或错误内容', async () => {
    const { read } = await connect()
    monitor.requestMonitorEvents.notify()
    expect(await read()).toBe('event: change\ndata: {}\n\n')
  })

  it('心跳保持连接但不触发刷新，断线释放订阅，重连重新补刷', async () => {
    vi.useFakeTimers()
    const originalSubscribe = monitor.requestMonitorEvents.subscribe
    const unsubscribed = vi.fn()
    vi.spyOn(monitor.requestMonitorEvents, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = originalSubscribe(listener)
      return () => {
        unsubscribe()
        unsubscribed()
      }
    })
    const { reader, read } = await connect()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await read()).toBe(': keep-alive\n\n')
    await reader.cancel()
    expect(unsubscribed).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await connect()
  })
})
