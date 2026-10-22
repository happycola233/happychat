import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageQueueDTO, QueuedMessage } from '@shared/schemas/message-queue'
import type { RunState } from '@shared/types/domain'
import type { AppEnv } from '../http/types'

let directory: string
let client: typeof import('../db/client')
let schema: typeof import('../db/schema')
let service: typeof import('./message-queue')
let manager: typeof import('../runs/manager')
let storage: typeof import('../storage/files')
let app: Hono<AppEnv>
let cookie: string
let stopRunner: () => void

beforeAll(async () => {
  mkdirSync('.tmp', { recursive: true })
  directory = mkdtempSync(join(process.cwd(), '.tmp', 'cloud-queue-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = directory
  process.env.DATABASE_URL = join(directory, 'test.db')
  process.env.SESSION_SECRET = 'synthetic-queue-session-secret'
  vi.resetModules()
  client = await import('../db/client')
  schema = await import('../db/schema')
  const { runMigrations } = await import('../db/migrate')
  runMigrations()
  service = await import('./message-queue')
  manager = await import('../runs/manager')
  storage = await import('../storage/files')
  vi.spyOn(manager.runManager, 'start').mockImplementation(() => {})
  stopRunner = service.startMessageQueueRunner()
  const { messageQueueRoutes } = await import('../routes/message-queues')
  app = new Hono<AppEnv>().route('/api/message-queues', messageQueueRoutes)
})

beforeEach(async () => {
  client.sqlite.exec('DELETE FROM users; DELETE FROM models; DELETE FROM providers')
  vi.mocked(manager.runManager.start).mockClear()
  client.db
    .insert(schema.users)
    .values([
      { id: 'owner', username: 'queue-owner', passwordHash: 'hash' },
      { id: 'other', username: 'queue-other', passwordHash: 'hash' },
    ])
    .run()
  client.db
    .insert(schema.providers)
    .values({
      id: 'provider',
      name: 'Synthetic',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test',
    })
    .run()
  client.db
    .insert(schema.models)
    .values({
      id: 'model',
      providerId: 'provider',
      modelId: 'synthetic-model',
      displayName: '测试模型',
      kind: 'chat',
      capabilities: {
        vision: true,
        file_input: true,
        reasoning: false,
        web_search: false,
        x_search: false,
        image_generation: false,
        artifacts: false,
      },
    })
    .run()
  const { createSession } = await import('../auth/session')
  const login = new Hono().get('/', async (c) => {
    await createSession(c, 'owner')
    return c.body(null, 204)
  })
  cookie = (await login.request('/')).headers.get('set-cookie')!.split(';')[0]!
})

afterAll(() => {
  stopRunner?.()
  client?.sqlite.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const conversation = client.db
    .insert(schema.conversations)
    .values({ userId: 'owner', modelId: 'model' })
    .returning()
    .get()!
  const answer = client.db
    .insert(schema.messages)
    .values({
      conversationId: conversation.id,
      role: 'assistant',
      status: 'streaming',
      content: [],
    })
    .returning()
    .get()!
  const run = client.db
    .insert(schema.runs)
    .values({
      conversationId: conversation.id,
      userId: 'owner',
      modelId: 'model',
      assistantMessageId: answer.id,
      state: 'running',
    })
    .returning()
    .get()!
  client.db
    .update(schema.conversations)
    .set({ activeLeafId: answer.id })
    .where(eq(schema.conversations.id, conversation.id))
    .run()
  return { conversationId: conversation.id, parentId: answer.id, runId: run.id }
}

function message(text: string, overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: randomUUID(),
    input: { modelId: 'model', text },
    attachments: [],
    imageSources: [],
    modelName: '测试模型',
    runPrefs: null,
    reasoningEnabled: false,
    ...overrides,
  }
}

async function enqueue(f: ReturnType<typeof fixture>, item: QueuedMessage) {
  const result = service.changeMessageQueue('owner', f.conversationId, {
    type: 'enqueue',
    message: item,
    parentId: f.parentId,
  })
  await service.advanceMessageQueue(f.conversationId)
  return result
}

async function finish(conversationId: string, runId: string, state: RunState) {
  const run = client.db
    .update(schema.runs)
    .set({ state, finishedAt: new Date() })
    .where(eq(schema.runs.id, runId))
    .returning()
    .get()!
  client.db
    .update(schema.messages)
    .set({
      status: state === 'completed' ? 'complete' : 'error',
      content: [{ type: 'output_text', text: '合成测试回复' }],
    })
    .where(eq(schema.messages.id, run.assistantMessageId!))
    .run()
  await service.advanceMessageQueue(conversationId)
}

describe('持久化消息队列', () => {
  it('云端恢复完整内容和重排顺序；并发推进只创建一轮，并沿上一回复继续', async () => {
    const f = fixture()
    const first = message('第一条')
    const second = message('第二条')
    await enqueue(f, first)
    await enqueue(f, second)
    first.input.text = '客户端随后更改的草稿'
    service.changeMessageQueue('owner', f.conversationId, {
      type: 'reorder',
      messageId: second.id,
      targetId: first.id,
    })
    await service.advanceMessageQueue(f.conversationId)
    const response = await app.request('/api/message-queues', { headers: { Cookie: cookie } })
    const saved = ((await response.json()) as { queues: MessageQueueDTO[] }).queues[0]!
    expect(saved.items.map((item: QueuedMessage) => item.input.text)).toEqual(['第二条', '第一条'])
    await finish(f.conversationId, f.runId, 'completed')
    await Promise.all(
      Array.from({ length: 4 }, () => service.advanceMessageQueue(f.conversationId)),
    )
    expect(manager.runManager.start).toHaveBeenCalledTimes(1)
    const started = vi.mocked(manager.runManager.start).mock.calls[0]![0]
    expect(started.run.idempotencyKey).toBe(`queue:${second.id}`)
    const userMessage = client.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, started.assistantMessage.parentId!))
      .get()!
    expect(userMessage.parentId).toBe(f.parentId)
    expect(service.getMessageQueue(f.conversationId)?.items.map((item) => item.id)).toEqual([
      first.id,
    ])
    await finish(f.conversationId, started.run.id, 'completed')
    expect(manager.runManager.start).toHaveBeenCalledTimes(2)
    expect(service.getMessageQueue(f.conversationId)?.items).toEqual([])
    // 已接受入队但 HTTP 回包丢失后的重试，也不会重新发送。
    await enqueue(f, second)
    expect(service.getMessageQueue(f.conversationId)?.items).toEqual([])
  })

  it.each(['failed', 'canceled', 'interrupted'] as const)(
    '%s 会持久化暂停及剩余消息，手动继续只发送一条',
    async (state) => {
      const f = fixture()
      const one = message('保留这条')
      await enqueue(f, one)
      await enqueue(f, message('以及这条'))
      await finish(f.conversationId, f.runId, state)
      expect(service.listMessageQueues('owner')[0]).toMatchObject({
        paused: true,
        waitingRunId: null,
        items: [one, expect.anything()],
      })
      expect(manager.runManager.start).not.toHaveBeenCalled()
      service.changeMessageQueue('owner', f.conversationId, { type: 'resume' })
      await service.advanceMessageQueue(f.conversationId)
      expect(manager.runManager.start).toHaveBeenCalledTimes(1)
      expect(service.getMessageQueue(f.conversationId)?.items).toHaveLength(1)
    },
  )

  it('发送前模型失效，首项保留且后续不会越过它', async () => {
    const f = fixture()
    await enqueue(f, message('无效模型', { input: { modelId: 'missing', text: '无效模型' } }))
    await enqueue(f, message('不能跳过首项'))
    await finish(f.conversationId, f.runId, 'completed')
    const queue = service.getMessageQueue(f.conversationId)!
    expect(queue.paused).toBe(true)
    expect(queue.sendingId).toBeNull()
    expect(queue.items).toHaveLength(2)
    expect(manager.runManager.start).not.toHaveBeenCalled()
  })

  it('停止与成功终态竞争时保持暂停；继续时等待仍在运行的回复', async () => {
    const f = fixture()
    await enqueue(f, message('后续'))
    service.pauseMessageQueue(f.conversationId)
    service.changeMessageQueue('owner', f.conversationId, { type: 'resume' })
    await service.advanceMessageQueue(f.conversationId)
    expect(manager.runManager.start).not.toHaveBeenCalled()
    service.pauseMessageQueue(f.conversationId)
    await finish(f.conversationId, f.runId, 'completed')
    expect(service.getMessageQueue(f.conversationId)?.paused).toBe(true)
    expect(manager.runManager.start).not.toHaveBeenCalled()
  })

  it('排队期间账号被停用时保留消息且不再自动调用模型', async () => {
    const f = fixture()
    await enqueue(f, message('等待'))
    client.db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, 'owner')).run()
    await finish(f.conversationId, f.runId, 'completed')
    expect(service.getMessageQueue(f.conversationId)?.paused).toBe(true)
    expect(manager.runManager.start).not.toHaveBeenCalled()
  })

  it('失败后重新生成，继续队列会接在新的回复分支后面', async () => {
    const f = fixture()
    await enqueue(f, message('后续内容'))
    await finish(f.conversationId, f.runId, 'failed')
    const answer = client.db
      .insert(schema.messages)
      .values({ conversationId: f.conversationId, role: 'assistant', content: [] })
      .returning()
      .get()!
    const retry = client.db
      .insert(schema.runs)
      .values({
        conversationId: f.conversationId,
        userId: 'owner',
        modelId: 'model',
        state: 'running',
        assistantMessageId: answer.id,
      })
      .returning()
      .get()!
    service.waitMessageQueueForRun(f.conversationId, retry.id, answer.id)
    await finish(f.conversationId, retry.id, 'completed')
    expect(service.getMessageQueue(f.conversationId)).toMatchObject({
      paused: true,
      parentId: answer.id,
    })
    service.changeMessageQueue('owner', f.conversationId, { type: 'resume' })
    await service.advanceMessageQueue(f.conversationId)
    const submitted = vi.mocked(manager.runManager.start).mock.calls[0]![0]
    const user = client.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, submitted.assistantMessage.parentId!))
      .get()!
    expect(user.parentId).toBe(answer.id)
  })

  it('构建请求失败时移除准备中的占位，原消息仍可编辑或重试', async () => {
    const f = fixture()
    await enqueue(f, message('等待'))
    const prepare = await import('../runs/prepare')
    const spy = vi
      .spyOn(prepare, 'prepareRun')
      .mockRejectedValueOnce(new Error('synthetic preparation failure'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await finish(f.conversationId, f.runId, 'completed')
      expect(service.getMessageQueue(f.conversationId)).toMatchObject({
        paused: true,
        sendingId: null,
      })
      expect(service.getMessageQueue(f.conversationId)?.items).toHaveLength(1)
    } finally {
      spy.mockRestore()
      log.mockRestore()
    }
  })

  it('拖动期间延迟发送，放下按新顺序推进；失去页面后占用会到期', async () => {
    const f = fixture()
    const one = message('一')
    const two = message('二')
    await enqueue(f, one)
    await enqueue(f, two)
    service.changeMessageQueue('owner', f.conversationId, { type: 'hold' })
    await finish(f.conversationId, f.runId, 'completed')
    expect(manager.runManager.start).not.toHaveBeenCalled()
    service.changeMessageQueue('owner', f.conversationId, {
      type: 'reorder',
      messageId: two.id,
      targetId: one.id,
    })
    await service.advanceMessageQueue(f.conversationId)
    expect(vi.mocked(manager.runManager.start).mock.calls[0]![0].run.idempotencyKey).toBe(
      `queue:${two.id}`,
    )
    service.changeMessageQueue('owner', f.conversationId, { type: 'hold' })
    const currentRun = service.getMessageQueue(f.conversationId)!.waitingRunId!
    await finish(f.conversationId, currentRun, 'completed')
    client.db
      .update(schema.messageQueues)
      .set({ reorderUntil: Date.now() - 1 })
      .where(eq(schema.messageQueues.conversationId, f.conversationId))
      .run()
    await service.advanceMessageQueue(f.conversationId)
    expect(manager.runManager.start).toHaveBeenCalledTimes(2)
  })

  it('服务重启不会重发已接受的队列项，剩余项暂停保留', async () => {
    const f = fixture()
    await enqueue(f, message('已发送'))
    await enqueue(f, message('仍待发送'))
    await finish(f.conversationId, f.runId, 'completed')
    await manager.recoverInterruptedRuns()
    await service.recoverMessageQueues()
    const queue = service.getMessageQueue(f.conversationId)!
    expect(queue.paused).toBe(true)
    expect(queue.items.map((item) => item.input.text)).toEqual(['仍待发送'])
    expect(manager.runManager.start).toHaveBeenCalledTimes(1)
  })

  it('准备阶段重启时清理尚未提交的消息，保留原队列供继续', async () => {
    const f = fixture()
    const item = message('等待重试')
    await enqueue(f, item)
    const orphan = client.db
      .insert(schema.messages)
      .values({
        conversationId: f.conversationId,
        role: 'user',
        content: [{ type: 'input_text', text: item.input.text }],
      })
      .returning()
      .get()!
    client.db
      .update(schema.messageQueues)
      .set({ sendingId: item.id, preparingMessageId: orphan.id, waitingRunId: null })
      .where(eq(schema.messageQueues.conversationId, f.conversationId))
      .run()
    await service.recoverMessageQueues()
    expect(service.getMessageQueue(f.conversationId)).toMatchObject({
      sendingId: null,
      preparingMessageId: null,
      paused: true,
    })
    expect(
      client.db.select().from(schema.messages).where(eq(schema.messages.id, orphan.id)).get(),
    ).toBeUndefined()
    expect(service.getMessageQueue(f.conversationId)?.items).toHaveLength(1)
  })

  it('账号间隔离，伪造父消息/附件被拒绝；删除会话级联清除队列', async () => {
    const f = fixture()
    await enqueue(f, message('私有内容'))
    expect(service.listMessageQueues('other')).toEqual([])
    expect(() => service.changeMessageQueue('other', f.conversationId, { type: 'resume' })).toThrow(
      '聊天不存在',
    )
    expect(() =>
      service.changeMessageQueue('owner', f.conversationId, {
        type: 'enqueue',
        parentId: 'wrong-chat',
        message: message('父节点无效'),
      }),
    ).toThrow('消息不在当前聊天中')
    expect(() =>
      service.changeMessageQueue('owner', f.conversationId, {
        type: 'enqueue',
        parentId: f.parentId,
        message: message('附件无效', {
          input: {
            modelId: 'model',
            text: '附件无效',
            attachments: [{ attachmentId: 'foreign-file', kind: 'file', filename: 'fake.txt' }],
          },
        }),
      }),
    ).toThrow('附件已失效')
    client.db
      .delete(schema.conversations)
      .where(eq(schema.conversations.id, f.conversationId))
      .run()
    expect(service.listMessageQueues('owner')).toEqual([])
  })

  it('待发附件跨过 24 小时仍保留；删除排队项后恢复正常清理', async () => {
    const f = fixture()
    const id = randomUUID()
    const storagePath = storage.saveUpload(
      'owner',
      id,
      'sample.txt',
      'text/plain',
      Buffer.from('synthetic fixture'),
    )
    client.db
      .insert(schema.attachments)
      .values({
        id,
        userId: 'owner',
        kind: 'file',
        mime: 'text/plain',
        filename: 'sample.txt',
        byteSize: 17,
        storagePath,
        createdAt: new Date(0),
      })
      .run()
    const item = message('', {
      input: {
        modelId: 'model',
        text: '',
        attachments: [{ attachmentId: id, kind: 'file', filename: 'sample.txt' }],
      },
    })
    await enqueue(f, item)
    service.pauseMessageQueue(f.conversationId)
    const { cleanupExpiredOrphanAttachments } = await import('./attachment-cleanup')
    await cleanupExpiredOrphanAttachments()
    expect(existsSync(storagePath)).toBe(true)
    expect(service.listMessageQueues('owner')[0]!.items[0]!.attachments[0]!.filename).toBe(
      'sample.txt',
    )
    service.changeMessageQueue('owner', f.conversationId, { type: 'remove', messageId: item.id })
    await service.advanceMessageQueue(f.conversationId)
    await cleanupExpiredOrphanAttachments()
    expect(existsSync(storagePath)).toBe(false)
  })

  it('撤回编辑时给旧附件重新计算草稿保留期', async () => {
    const f = fixture()
    const id = randomUUID()
    const storagePath = storage.saveUpload(
      'owner',
      id,
      'edit.txt',
      'text/plain',
      Buffer.from('synthetic'),
    )
    client.db
      .insert(schema.attachments)
      .values({
        id,
        userId: 'owner',
        kind: 'file',
        mime: 'text/plain',
        filename: 'edit.txt',
        byteSize: 9,
        storagePath,
        createdAt: new Date(0),
      })
      .run()
    const item = message('编辑附件', {
      input: {
        modelId: 'model',
        text: '编辑附件',
        attachments: [{ attachmentId: id, kind: 'file', filename: 'edit.txt' }],
      },
    })
    await enqueue(f, item)
    service.changeMessageQueue('owner', f.conversationId, { type: 'take', messageId: item.id })
    await service.advanceMessageQueue(f.conversationId)
    const { cleanupExpiredOrphanAttachments } = await import('./attachment-cleanup')
    await cleanupExpiredOrphanAttachments()
    expect(existsSync(storagePath)).toBe(true)
  })
})
