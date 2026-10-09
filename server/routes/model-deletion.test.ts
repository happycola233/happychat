import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../http/types'

let temporaryDirectory: string
let app: Hono<AppEnv>
let adminCookie: string
let userCookie: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let sequence = 0

beforeAll(async () => {
  const temporaryRoot = resolve('.tmp')
  mkdirSync(temporaryRoot, { recursive: true })
  temporaryDirectory = mkdtempSync(join(temporaryRoot, 'model-deletion-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = temporaryDirectory
  process.env.DATABASE_URL = join(temporaryDirectory, 'test.db')
  process.env.SESSION_SECRET = 'test-session-secret-model-deletion'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  migration.runMigrations()
  await dbClient.db.insert(schema.users).values([
    { id: 'admin', username: 'admin', passwordHash: 'hash', role: 'admin' },
    { id: 'user', username: 'user', passwordHash: 'hash', role: 'user' },
  ])
  await dbClient.db.insert(schema.providers).values({
    id: 'provider',
    name: 'Test provider',
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
  })

  const { createSession } = await import('../auth/session')
  const loginApp = new Hono()
  loginApp.get('/:id', async (c) => {
    await createSession(c, c.req.param('id'))
    return c.body(null, 204)
  })
  adminCookie = (await loginApp.request('/admin')).headers.get('set-cookie')!.split(';')[0]!
  userCookie = (await loginApp.request('/user')).headers.get('set-cookie')!.split(';')[0]!

  const { adminRoutes } = await import('./admin')
  app = new Hono<AppEnv>().route('/api/admin', adminRoutes)
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function createModels() {
  const ids = Array.from({ length: 3 }, () => `delete-model-${sequence++}`)
  await dbClient.db.insert(schema.models).values(
    ids.map((id) => ({
      id,
      providerId: 'provider',
      modelId: id,
      displayName: id,
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        x_search: false,
        image_generation: false,
        reasoning: false,
      },
    })),
  )
  return ids
}

function batchDelete(modelIds: string[], cookie = adminCookie) {
  return app.request('/api/admin/models/batch-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ modelIds }),
  })
}

describe('model batch deletion', () => {
  it('只删除所选模型，清理授权且保留聊天、消息和用量快照', async () => {
    const ids = await createModels()
    const selectedIds = ids.slice(0, 2)
    const modelId = selectedIds[0]!
    await dbClient.db.insert(schema.modelUserAccess).values({ modelId, userId: 'user' })
    await dbClient.db.insert(schema.conversations).values({
      id: 'conversation',
      userId: 'user',
      modelId,
      title: '测试会话',
    })
    const content = [{ type: 'output_text' as const, text: '测试消息' }]
    await dbClient.db.insert(schema.messages).values({
      id: 'message',
      conversationId: 'conversation',
      modelId,
      role: 'assistant',
      content,
    })
    await dbClient.db.insert(schema.usageLogs).values({
      id: 'usage',
      userId: 'user',
      modelId,
      modelLabel: 'upstream-test-model',
      costUsd: 0.25,
      totalTokens: 100,
    })

    const response = await batchDelete(selectedIds)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, deleted: 2 })
    expect(
      await dbClient.db
        .select({ id: schema.models.id })
        .from(schema.models)
        .where(inArray(schema.models.id, ids)),
    ).toEqual([{ id: ids[2] }])
    expect(
      await dbClient.db
        .select()
        .from(schema.modelUserAccess)
        .where(eq(schema.modelUserAccess.modelId, modelId)),
    ).toEqual([])
    expect(
      await dbClient.db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, 'conversation')),
    ).toMatchObject([{ modelId: null, title: '测试会话' }])
    expect(
      await dbClient.db.select().from(schema.messages).where(eq(schema.messages.id, 'message')),
    ).toMatchObject([{ modelId: null, content }])
    expect(
      await dbClient.db.select().from(schema.usageLogs).where(eq(schema.usageLogs.id, 'usage')),
    ).toMatchObject([
      { modelId: null, modelLabel: 'upstream-test-model', costUsd: 0.25, totalTokens: 100 },
    ])
  })

  it('重复提交和已删除的模型沿用单删语义，返回实际删除数', async () => {
    const ids = await createModels()
    const response = await batchDelete([...ids, 'already-deleted-model'])
    expect(await response.json()).toEqual({ ok: true, deleted: 3 })
    expect(await (await batchDelete(ids)).json()).toEqual({ ok: true, deleted: 0 })
  })

  it('拒绝空名单、空 ID、重复和超限名单，且不删除任何模型', async () => {
    const ids = await createModels()
    for (const modelIds of [
      [],
      [ids[0]!, ' '],
      [ids[0]!, ids[0]!],
      [...ids, ...Array.from({ length: 998 }, (_, i) => `extra-${i}`)],
    ]) {
      expect((await batchDelete(modelIds)).status).toBe(400)
    }
    expect(
      await dbClient.db.select().from(schema.models).where(inArray(schema.models.id, ids)),
    ).toHaveLength(3)
  })

  it('未登录与普通用户均不能批量删除模型', async () => {
    const ids = await createModels()
    expect((await batchDelete(ids, '')).status).toBe(401)
    expect((await batchDelete(ids, userCookie)).status).toBe(403)
    expect(
      await dbClient.db.select().from(schema.models).where(inArray(schema.models.id, ids)),
    ).toHaveLength(3)
  })
})
