import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WireEvent } from '@shared/types/events'
import type { AppEnv } from '../http/types'

let temporaryDirectory: string
let app: Hono<AppEnv>
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let userCookie: string

async function cookieFor(userId: string): Promise<string> {
  const { createSession } = await import('../auth/session')
  const loginApp = new Hono()
  loginApp.get('/', async (c) => {
    await createSession(c, userId)
    return c.body(null, 204)
  })
  const response = await loginApp.request('/')
  return response.headers.get('set-cookie')?.split(';')[0] ?? ''
}

function parseSseEvents(body: string): WireEvent[] {
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as WireEvent)
}

beforeAll(async () => {
  const testTempRoot = join(process.cwd(), '.tmp')
  mkdirSync(testTempRoot, { recursive: true })
  temporaryDirectory = mkdtempSync(join(testTempRoot, 'happychat-run-routes-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-run-routes'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  migration.runMigrations()

  const [{ runRoutes }] = await Promise.all([import('./runs')])
  app = new Hono<AppEnv>()
  app.route('/api/runs', runRoutes)

  await dbClient.db.insert(schema.users).values({
    id: 'run-route-user',
    username: 'run-route-user',
    passwordHash: 'hash',
  })
  userCookie = await cookieFor('run-route-user')
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('GET /api/runs/:id/stream', () => {
  it('回放保留原始事件时间，合并 delta 不改变思考起点', async () => {
    const conversation = dbClient.db
      .insert(schema.conversations)
      .values({ userId: 'run-route-user' })
      .returning()
      .get()
    const run = dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: conversation.id,
        userId: 'run-route-user',
        state: 'completed',
        finishedAt: new Date(5000),
      })
      .returning()
      .get()
    dbClient.db
      .insert(schema.runEvents)
      .values([
        {
          runId: run.id,
          sequenceNumber: 0,
          type: 'response.reasoning_summary_text.delta',
          data: { delta: '第一' },
          createdAt: new Date(1000),
        },
        {
          runId: run.id,
          sequenceNumber: 1,
          type: 'response.reasoning_summary_text.delta',
          data: { delta: '段' },
          createdAt: new Date(3000),
        },
        {
          runId: run.id,
          sequenceNumber: 2,
          type: 'run.done',
          data: { state: 'completed' },
          createdAt: new Date(5000),
        },
      ])
      .run()
    const response = await app.request(`/api/runs/${run.id}/stream`, {
      headers: { Cookie: userCookie },
    })
    expect(parseSseEvents(await response.text())).toEqual([
      {
        type: 'response.reasoning_summary_text.delta',
        seq: 1,
        data: { delta: '第一段' },
        createdAt: 1000,
      },
      { type: 'run.done', seq: 2, data: { state: 'completed' }, createdAt: 5000 },
    ])
  })

  it('缺少持久化终态事件时，用 run 快照合成包含错误消息与代码的 run.error', async () => {
    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: 'run-route-user' })
      .returning()
    if (!conversation) throw new Error('创建测试会话失败')

    const [run] = await dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: conversation.id,
        userId: 'run-route-user',
        state: 'failed',
        errorMessage: '上游拒绝了请求',
        errorCode: 'request_rejected',
        finishedAt: new Date(),
      })
      .returning()
    if (!run) throw new Error('创建测试 run 失败')

    const response = await app.request(`/api/runs/${run.id}/stream`, {
      headers: { Cookie: userCookie },
    })

    expect(response.status).toBe(200)
    expect(parseSseEvents(await response.text())).toEqual([
      {
        type: 'run.error',
        seq: 0,
        createdAt: run.finishedAt!.getTime(),
        data: {
          state: 'failed',
          message: '上游拒绝了请求',
          code: 'request_rejected',
        },
      },
    ])
  })

  it.each(['refusal', 'content_filter'] as const)(
    '从审计快照还原 %s 的代码与部分输出作废标记',
    async (terminalReason) => {
      const [conversation] = await dbClient.db
        .insert(schema.conversations)
        .values({ userId: 'run-route-user' })
        .returning()
      if (!conversation) throw new Error('创建测试会话失败')

      const [run] = await dbClient.db
        .insert(schema.runs)
        .values({
          conversationId: conversation.id,
          userId: 'run-route-user',
          state: 'failed',
          errorMessage: `业务终态：${terminalReason}`,
          finishedAt: new Date(),
        })
        .returning()
      if (!run) throw new Error('创建测试 run 失败')
      await dbClient.db.insert(schema.usageLogs).values({
        runId: run.id,
        outcome: 'failed',
        terminalReason,
        success: false,
        errorType: terminalReason,
      })

      const response = await app.request(`/api/runs/${run.id}/stream`, {
        headers: { Cookie: userCookie },
      })

      expect(parseSseEvents(await response.text())).toEqual([
        {
          type: 'run.error',
          seq: 0,
          createdAt: run.finishedAt!.getTime(),
          data: {
            state: 'failed',
            message: `业务终态：${terminalReason}`,
            code: terminalReason,
            discardPartialOutput: true,
          },
        },
      ])
    },
  )
})

describe('GET /api/runs/active', () => {
  it('恢复当前尝试的思考起点和暂停时间，不使用第一次尝试', async () => {
    const conversation = dbClient.db
      .insert(schema.conversations)
      .values({ userId: 'run-route-user' })
      .returning()
      .get()
    const run = dbClient.db
      .insert(schema.runs)
      .values({ conversationId: conversation.id, userId: 'run-route-user', state: 'running' })
      .returning()
      .get()
    const events = [
      { type: 'response.created', createdAt: 1000 },
      { type: 'answer.started', createdAt: 3000 },
      { type: 'run.output_reset', createdAt: 8000 },
      { type: 'response.created', createdAt: 6000 },
      { type: 'response.reasoning_text.delta', createdAt: 8000, data: { delta: '当前思考' } },
    ]
    dbClient.db
      .insert(schema.runEvents)
      .values(
        events.map((event, sequenceNumber) => ({
          ...event,
          runId: run.id,
          sequenceNumber,
          createdAt: new Date(event.createdAt),
          data: event.data ?? {},
        })),
      )
      .run()
    const active = async () => {
      const response = await app.request(`/api/runs/active?conversationId=${conversation.id}`, {
        headers: { Cookie: userCookie },
      })
      return response.json()
    }
    expect(await active()).toMatchObject({
      run: { upstreamStartedAt: 6000, reasoningDurationMs: null },
    })
    dbClient.db
      .insert(schema.runEvents)
      .values({
        runId: run.id,
        sequenceNumber: 5,
        type: 'run.retry',
        createdAt: new Date(11000),
        data: { phase: 'waiting' },
      })
      .run()
    expect(await active()).toMatchObject({
      run: { upstreamStartedAt: 6000, reasoningDurationMs: 5000 },
    })
  })
})
