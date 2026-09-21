import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportOptionsSchema, type ExportOptions } from '@shared/schemas/export'
import type { MsgRow } from '../runs/types'

const tempRoot = resolve('.tmp')
let tempDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let collect: typeof import('./collect')
let fixtureNumber = 0

beforeAll(async () => {
  mkdirSync(tempRoot, { recursive: true })
  tempDir = mkdtempSync(join(tempRoot, 'export-metadata-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('DATA_DIR', tempDir)
  vi.stubEnv('DATABASE_URL', join(tempDir, 'metadata.db'))
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-export-metadata')
  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  collect = await import('./collect')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  vi.unstubAllEnvs()
  if (tempDir) {
    if (!resolve(tempDir).startsWith(`${tempRoot}${sep}`)) throw new Error('临时目录超出测试范围')
    rmSync(tempDir, { recursive: true, force: true })
  }
})

async function createFixture(messageValues: Partial<MsgRow> = {}) {
  const { db } = dbClient
  const number = fixtureNumber++
  const user = await db
    .insert(schema.users)
    .values({ username: `metadata-user-${number}`, passwordHash: 'test-hash' })
    .returning()
    .get()
  const provider = await db
    .insert(schema.providers)
    .values({
      name: `metadata-provider-${number}`,
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
    })
    .returning()
    .get()
  const model = await db
    .insert(schema.models)
    .values({
      providerId: provider.id,
      modelId: 'example-model-v1',
      displayName: '示例模型一',
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        x_search: false,
        image_generation: false,
        reasoning: true,
      },
      allowedEfforts: [{ value: 'high', description: '深度思考' }],
      defaultEffort: 'high',
      defaultParams: { reasoning_effort: 'high' },
    })
    .returning()
    .get()
  const conversation = await db
    .insert(schema.conversations)
    .values({ userId: user.id, title: '虚构元数据测试' })
    .returning()
    .get()
  const message = await db
    .insert(schema.messages)
    .values({
      conversationId: conversation.id,
      role: 'assistant',
      modelId: model.id,
      content: [{ type: 'output_text', text: '这是一条完全虚构的测试回复。' }],
      ...messageValues,
    })
    .returning()
    .get()
  await db
    .update(schema.conversations)
    .set({ activeLeafId: message.id })
    .where(eq(schema.conversations.id, conversation.id))
  return { user, model, conversation, message }
}

type Fixture = Awaited<ReturnType<typeof createFixture>>

async function addRun(fixture: Fixture, requestParams: Record<string, unknown> = {}) {
  const run = await dbClient.db
    .insert(schema.runs)
    .values({
      conversationId: fixture.conversation.id,
      userId: fixture.user.id,
      assistantMessageId: fixture.message.id,
      modelId: fixture.model.id,
      requestParams,
      state: 'completed',
    })
    .returning()
    .get()
  await dbClient.db
    .update(schema.messages)
    .set({ runId: run.id })
    .where(eq(schema.messages.id, fixture.message.id))
  return run
}

async function collectMessage(fixture: Fixture, overrides: Partial<ExportOptions> = {}) {
  const result = await collect.collectExportSource(
    fixture.user.id,
    fixture.conversation.id,
    exportOptionsSchema.parse({
      format: 'chatlog-md',
      includeUsage: true,
      attachmentMode: 'omit',
      ...overrides,
    }),
    { readFiles: false, exportedAt: Date.UTC(2026, 8, 21), embedBudget: collect.newEmbedBudget() },
  )
  if (!result.ok) throw new Error(`测试数据未能导出：${result.code}`)
  return result.source.messages[0]!
}

describe('chatlog-md/2 持久化元数据', () => {
  it.each([
    { label: '未记录', input: {}, expected: undefined },
    { label: '仅总量', input: { totalTokens: 12 }, expected: { total_tokens: 12 } },
    {
      label: '只有部分明细，没有总量',
      input: { outputTokens: 7, reasoningTokens: 3 },
      expected: { output_tokens: 7, reasoning_tokens: 3 },
    },
    {
      label: '真实的零',
      input: {
        inputTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
      expected: {
        input_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
      },
    },
    {
      label: '上游总量与分量不一致',
      input: {
        inputTokens: 100,
        cachedTokens: 30,
        cacheWriteTokens: 20,
        outputTokens: 40,
        reasoningTokens: 10,
        totalTokens: 150,
      },
      expected: {
        input_tokens: 100,
        cache_read_tokens: 30,
        cache_write_tokens: 20,
        output_tokens: 40,
        reasoning_tokens: 10,
        total_tokens: 150,
      },
    },
    {
      label: '分量齐全但不补造总量',
      input: { inputTokens: 100, outputTokens: 20 },
      expected: { input_tokens: 100, output_tokens: 20 },
    },
  ])('逐字段保留用量：$label', async ({ input, expected }) => {
    const fixture = await createFixture(input)
    const message = await collectMessage(fixture)
    expect(message.chatlogMetadata?.usage).toEqual(expected)
  })

  it('使用请求时模型名称与自定义推理强度；重命名或删除模型不改写历史', async () => {
    const fixture = await createFixture()
    const run = await addRun(fixture, { reasoning_effort: 'low' })
    await dbClient.db.insert(schema.usageLogs).values({
      runId: run.id,
      userId: fixture.user.id,
      modelId: fixture.model.id,
      modelLabel: 'example-model-v1',
      modelDisplayName: '请求时的示例模型',
      reasoningEffort: 'future-effort',
    })
    await dbClient.db
      .update(schema.models)
      .set({ modelId: 'example-model-v2', displayName: '改名后的示例模型' })
      .where(eq(schema.models.id, fixture.model.id))
    const expected = {
      model: { id: 'example-model-v1', name: '请求时的示例模型' },
      reasoning: { effort: 'future-effort' },
    }
    expect((await collectMessage(fixture)).chatlogMetadata).toEqual(expected)
    await dbClient.db.delete(schema.models).where(eq(schema.models.id, fixture.model.id))
    expect((await collectMessage(fixture)).chatlogMetadata).toEqual(expected)
  })

  it('旧日志仍关联同一模型配置时，保留请求时 ID 并补充当前显示名称', async () => {
    const fixture = await createFixture()
    const run = await addRun(fixture)
    await dbClient.db.insert(schema.usageLogs).values({
      runId: run.id,
      modelId: fixture.model.id,
      modelLabel: 'example-model-v1',
    })
    await dbClient.db
      .update(schema.models)
      .set({ modelId: 'example-model-v1-alias', displayName: '示例模型一（备用渠道）' })
      .where(eq(schema.models.id, fixture.model.id))

    const message = await collectMessage(fixture)
    expect(message.modelLabel).toBe('示例模型一（备用渠道）')
    expect(message.chatlogMetadata?.model).toEqual({
      id: 'example-model-v1',
      name: '示例模型一（备用渠道）',
    })
    expect((await collectMessage(fixture, { includeModel: false })).chatlogMetadata).toEqual({})
  })

  it('名称快照缺失且模型已删除时，不根据上游 ID 借用其他配置的名称', async () => {
    const fixture = await createFixture()
    const run = await addRun(fixture)
    await dbClient.db.insert(schema.usageLogs).values({
      runId: run.id,
      modelId: fixture.model.id,
      modelLabel: 'example-model-v1',
    })
    await createFixture()
    await dbClient.db.delete(schema.models).where(eq(schema.models.id, fixture.model.id))
    expect((await collectMessage(fixture)).chatlogMetadata).toEqual({
      model: { id: 'example-model-v1' },
    })
  })

  it('历史快照没有配置关联且模型标识不一致时，不补充当前名称', async () => {
    const fixture = await createFixture()
    const run = await addRun(fixture)
    await dbClient.db.insert(schema.usageLogs).values({ runId: run.id, modelLabel: 'older-model' })
    expect((await collectMessage(fixture)).chatlogMetadata).toEqual({
      model: { id: 'older-model' },
    })
  })

  it('没有日志时使用实际请求中的推理强度和上游模型 ID，不暴露内部配置 ID 或其他参数', async () => {
    const fixture = await createFixture()
    await addRun(fixture, {
      reasoning_effort: 'none',
      private_test_parameter: '不可导出的测试参数',
    })
    const message = await collectMessage(fixture)
    expect(message.chatlogMetadata).toEqual({
      model: { id: 'example-model-v1', name: '示例模型一' },
      reasoning: { effort: 'none' },
    })
    expect(JSON.stringify(message.chatlogMetadata)).not.toContain(fixture.model.id)
    expect(JSON.stringify(message.chatlogMetadata)).not.toContain('不可导出的测试参数')
  })

  it('没有请求强度快照时不将模型默认强度当成实际值，也不将日志默认零值当成消息用量', async () => {
    const fixture = await createFixture()
    const run = await addRun(fixture)
    await dbClient.db.insert(schema.usageLogs).values({ runId: run.id })
    expect((await collectMessage(fixture)).chatlogMetadata).toEqual({
      model: { id: 'example-model-v1', name: '示例模型一' },
    })
  })

  it('未记录模型时省略模型字段', async () => {
    const fixture = await createFixture({ modelId: null })
    expect((await collectMessage(fixture)).chatlogMetadata).toEqual({})
  })

  it('分别遵守模型、思考和用量选项', async () => {
    const fixture = await createFixture({ inputTokens: 2 })
    await addRun(fixture, { reasoning_effort: 'high' })
    expect((await collectMessage(fixture, { includeModel: false })).chatlogMetadata).toEqual({
      reasoning: { effort: 'high' },
      usage: { input_tokens: 2 },
    })
    expect((await collectMessage(fixture, { includeReasoning: false })).chatlogMetadata).toEqual({
      model: { id: 'example-model-v1', name: '示例模型一' },
      usage: { input_tokens: 2 },
    })
    expect((await collectMessage(fixture, { includeUsage: false })).chatlogMetadata).toEqual({
      model: { id: 'example-model-v1', name: '示例模型一' },
      reasoning: { effort: 'high' },
    })
    expect(
      (
        await collectMessage(fixture, {
          includeModel: false,
          includeReasoning: false,
          includeUsage: false,
        })
      ).chatlogMetadata,
    ).toEqual({})
  })

  it.each(['markdown', 'html', 'json', 'jsonl', 'txt'] as const)(
    '%s 保持原有 DTO，不附加 V2 元数据',
    async (format) => {
      const fixture = await createFixture({ totalTokens: 12 })
      const message = await collectMessage(fixture, { format })
      expect(message).not.toHaveProperty('chatlogMetadata')
      expect(message.modelId).toBe(fixture.model.id)
      expect(message.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalTokens: 12,
      })
    },
  )
})
