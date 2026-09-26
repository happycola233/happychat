import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../http/types'
import type { ConversationDetail } from '@shared/types/api'

let directory: string
let app: Hono<AppEnv>
let cookie: string
let client: typeof import('../db/client')

beforeAll(async () => {
  const temporaryRoot = resolve('.tmp')
  mkdirSync(temporaryRoot, { recursive: true })
  directory = mkdtempSync(resolve(temporaryRoot, 'message-bookmarks-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = directory
  process.env.DATABASE_URL = resolve(directory, 'test.db')
  process.env.SESSION_SECRET = 'test-message-bookmarks-secret'
  vi.resetModules()
  const { runMigrations } = await import('../db/migrate')
  client = await import('../db/client')
  const { users, conversations, messages } = await import('../db/schema')
  runMigrations()
  await client.db
    .insert(users)
    .values(['owner', 'other'].map((id) => ({ id, username: id, passwordHash: 'test' })))
  await client.db.insert(conversations).values([
    { id: 'own-chat', userId: 'owner' },
    { id: 'other-chat', userId: 'other' },
  ])
  await client.db.insert(messages).values([
    { id: 'prompt', conversationId: 'own-chat', role: 'user', content: [] },
    { id: 'answer', conversationId: 'own-chat', role: 'assistant', content: [] },
    { id: 'other-prompt', conversationId: 'other-chat', role: 'user', content: [] },
  ])
  const { createSession } = await import('../auth/session')
  const login = new Hono().get('/', async (c) => {
    await createSession(c, 'owner')
    return c.body(null, 204)
  })
  cookie = (await login.request('/')).headers.get('set-cookie')!.split(';')[0]!
  const { conversationRoutes } = await import('./conversations')
  app = new Hono<AppEnv>().route('/conversations', conversationRoutes)
})

afterAll(() => {
  client?.sqlite.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

const patch = (conversationId: string, messageId: string, bookmarked: unknown) =>
  app.request(`/conversations/${conversationId}/messages/${messageId}/bookmark`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmarked }),
  })

describe('message bookmarks', () => {
  it('收藏与取消收藏持久化，重复设置幂等且不更改聊天排序', async () => {
    const before = (await (
      await app.request('/conversations/own-chat', { headers: { Cookie: cookie } })
    ).json()) as ConversationDetail
    for (const bookmarked of [true, true, false]) {
      const response = await patch('own-chat', 'prompt', bookmarked)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: 'prompt', bookmarked })
      const detail = (await (
        await app.request('/conversations/own-chat', { headers: { Cookie: cookie } })
      ).json()) as ConversationDetail
      expect(detail.messages.find((message) => message.id === 'prompt')?.bookmarked).toBe(
        bookmarked,
      )
      expect(detail.conversation.updatedAt).toBe(before.conversation.updatedAt)
    }
  })

  it('拒绝跨账号、跨会话、助手消息和不存在的消息', async () => {
    for (const [conversationId, messageId] of [
      ['other-chat', 'other-prompt'],
      ['own-chat', 'other-prompt'],
      ['own-chat', 'answer'],
      ['own-chat', 'missing'],
    ]) {
      expect((await patch(conversationId!, messageId!, true)).status).toBe(404)
    }
  })

  it('验证登录态与布尔请求字段', async () => {
    expect(
      (
        await app.request('/conversations/own-chat/messages/prompt/bookmark', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: '{"bookmarked":true}',
        })
      ).status,
    ).toBe(401)
    expect((await patch('own-chat', 'prompt', 'true')).status).toBe(400)
  })
})
