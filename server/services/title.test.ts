import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModelPricing } from '@shared/types/domain'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let title: typeof import('./title')
let appConfig: typeof import('./appConfig')

/** 标题调用只需要一个会返回文本与用量的假上游；其余协议共用同一批映射函数。 */
vi.mock('../provider/client', () => ({
  providerClientFromRow: () => ({
    createResponse: async () => ({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '关于限额的讨论' }] }],
      usage: { input_tokens: 120, output_tokens: 8, total_tokens: 128 },
    }),
  }),
}))

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-title-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-title'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  title = await import('./title')
  appConfig = await import('./appConfig')
  migration.runMigrations()
  await appConfig.updateAppConfig({ titleEnabled: true, titleModelId: null })
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

const PRICING: ModelPricing = { input: 1_000_000, output: 1_000_000 }

/** 用户 + 可用模型 + 一轮问答（会话尚无标题）。 */
async function createFixture() {
  const userId = 'title-user'
  await dbClient.db
    .insert(schema.users)
    .values({ id: userId, username: userId, passwordHash: 'hash' })
  await dbClient.db.insert(schema.providers).values({
    id: 'title-provider',
    name: 'OpenAI',
    baseUrl: 'https://example.test/v1',
    apiKey: 'key',
    protocol: 'openai',
  })
  await dbClient.db.insert(schema.models).values({
    id: 'title-model',
    providerId: 'title-provider',
    modelId: 'gpt-test',
    displayName: 'GPT Test',
    kind: 'responses',
    pricing: PRICING,
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
    },
  })
  const [conversation] = await dbClient.db
    .insert(schema.conversations)
    .values({ userId, modelId: 'title-model' })
    .returning()
  const [userMessage] = await dbClient.db
    .insert(schema.messages)
    .values({ conversationId: conversation!.id, role: 'user', content: [] })
    .returning()
  const [assistantMessage] = await dbClient.db
    .insert(schema.messages)
    .values({
      conversationId: conversation!.id,
      parentId: userMessage!.id,
      role: 'assistant',
      content: [],
    })
    .returning()
  await dbClient.db
    .update(schema.conversations)
    .set({ activeLeafId: assistantMessage!.id })
    .where(eq(schema.conversations.id, conversation!.id))
  return { userId, conversationId: conversation!.id }
}

describe('标题总结', () => {
  it('写入标题并把上游用量记为 kind=title 的用量日志', async () => {
    const { userId, conversationId } = await createFixture()
    await title.maybeGenerateTitle(conversationId)

    const [conversation] = await dbClient.db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
    expect(conversation?.title).toBe('关于限额的讨论')

    const logs = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.userId, userId))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      kind: 'title',
      runId: null,
      conversationId,
      modelId: 'title-model',
      inputTokens: 120,
      outputTokens: 8,
      totalTokens: 128,
      success: true,
    })
    // 价格快照随行落库，标题请求的成本口径与对话请求完全一致。
    expect(logs[0]?.pricingSnapshot).toEqual(PRICING)
  })
})
