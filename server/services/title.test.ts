import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelPricing, QuotaRule } from '@shared/types/domain'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let title: typeof import('./title')
let appConfig: typeof import('./appConfig')
let fixtureSeq = 0

const providerMocks = vi.hoisted(() => ({
  createAnthropicMessage: vi.fn(),
  createChat: vi.fn(),
  createResponse: vi.fn(),
}))

/** 标题调用只需要一个会返回文本与用量的假上游；其余协议共用同一批映射函数。 */
vi.mock('../provider/client', () => ({
  providerClientFromRow: () => ({
    createAnthropicMessage: providerMocks.createAnthropicMessage,
    createChat: providerMocks.createChat,
    createResponse: providerMocks.createResponse,
  }),
}))

beforeEach(async () => {
  providerMocks.createAnthropicMessage.mockReset()
  providerMocks.createChat.mockReset()
  providerMocks.createResponse.mockReset()
  providerMocks.createAnthropicMessage.mockResolvedValue({
    content: [{ type: 'text', text: '关于限额的讨论' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 120, output_tokens: 8 },
  })
  providerMocks.createChat.mockResolvedValue({
    choices: [{ message: { content: '关于限额的讨论' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 },
  })
  providerMocks.createResponse.mockResolvedValue({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: '关于限额的讨论' }] }],
    usage: { input_tokens: 120, output_tokens: 8, total_tokens: 128 },
  })
  await appConfig.updateAppConfig({ titleModelId: null })
})

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
  await appConfig.updateAppConfig({ titleEnabled: true, titleModelId: null, quotaEnabled: true })
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

const PRICING: ModelPricing = { input: 1_000_000, output: 1_000_000 }

/** 用户 + 可用模型 + 一轮问答（会话尚无标题）。 */
async function createFixture(kind: 'responses' | 'chat' | 'anthropic' = 'responses') {
  const n = fixtureSeq++
  const userId = `title-user-${n}`
  const providerId = `title-provider-${n}`
  const modelId = `title-model-${n}`
  await dbClient.db
    .insert(schema.users)
    .values({ id: userId, username: userId, passwordHash: 'hash' })
  await dbClient.db.insert(schema.providers).values({
    id: providerId,
    name: 'OpenAI',
    baseUrl: 'https://example.test/v1',
    apiKey: 'key',
    protocol: 'openai',
  })
  await dbClient.db.insert(schema.models).values({
    id: modelId,
    providerId,
    modelId: 'gpt-test',
    displayName: 'GPT Test',
    kind,
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
    .values({ userId, modelId })
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
  return { userId, conversationId: conversation!.id, modelId }
}

async function bindPolicy(userId: string, rules: QuotaRule[]) {
  const policyId = `title-policy-${userId}`
  await dbClient.db.insert(schema.quotaPolicies).values({
    id: policyId,
    name: `Title policy ${userId}`,
    rules,
  })
  await dbClient.db.insert(schema.userQuotas).values({ userId, policyId })
}

describe('标题总结', () => {
  it('写入标题并把上游用量记为 kind=title 的用量日志', async () => {
    const { userId, conversationId, modelId } = await createFixture()
    await bindPolicy(userId, [
      {
        id: 'anchored-title-rule',
        label: null,
        scope: { type: 'all' },
        metric: 'requests',
        limit: { kind: 'amount', value: 10 },
        window: { type: 'anchored', hours: 168 },
        priority: 0,
      },
    ])
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
      modelId,
      inputTokens: 120,
      outputTokens: 8,
      totalTokens: 128,
      success: true,
    })
    // 价格快照随行落库，标题请求的成本口径与对话请求完全一致。
    expect(logs[0]?.pricingSnapshot).toEqual(PRICING)
    expect(logs[0]?.quotaAt).toBeNull()

    // 标题是后台维护调用，不得成为“首次请求起算”规则的首次请求。
    const cycles = await dbClient.db
      .select()
      .from(schema.quotaCycles)
      .where(eq(schema.quotaCycles.userId, userId))
    expect(cycles).toEqual([])
  })

  it('用户对话额度已经耗尽时仍调用标题模型，并继续单独记录请求日志', async () => {
    const { userId, conversationId, modelId } = await createFixture()
    await bindPolicy(userId, [
      {
        id: 'exhausted-chat-rule',
        label: null,
        scope: { type: 'all' },
        metric: 'requests',
        limit: { kind: 'amount', value: 1 },
        window: { type: 'calendar', period: 'day' },
        priority: 0,
      },
    ])
    await dbClient.db.insert(schema.usageLogs).values({
      userId,
      modelId,
      kind: 'chat',
      success: true,
    })

    await title.maybeGenerateTitle(conversationId)

    const [conversation] = await dbClient.db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
    expect(conversation?.title).toBe('关于限额的讨论')

    const logs = await dbClient.db
      .select({ kind: schema.usageLogs.kind })
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.userId, userId))
    expect(logs.map((row) => row.kind).sort()).toEqual(['chat', 'title'])
  })

  it('Responses 返回失败终态时记为失败事件并使用本地回退标题', async () => {
    providerMocks.createResponse.mockResolvedValueOnce({
      status: 'failed',
      error: { code: 'server_error', message: 'failed' },
      usage: { input_tokens: 12, output_tokens: 0, total_tokens: 12 },
    })
    const { userId, conversationId } = await createFixture()

    await title.maybeGenerateTitle(conversationId)

    const [conversation] = await dbClient.db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
    expect(conversation?.title).toBe('新聊天')

    const [log] = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.userId, userId))
    expect(log).toMatchObject({
      kind: 'title',
      inputTokens: 12,
      totalTokens: 12,
      success: false,
      errorType: 'server_error',
    })
  })

  it.each([
    [
      '拒绝内容',
      {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'refused' }] }],
        usage: { input_tokens: 14, output_tokens: 0, total_tokens: 14 },
      },
      'refusal',
    ],
    [
      '内容过滤截断',
      {
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
        output: [],
        usage: { input_tokens: 15, output_tokens: 0, total_tokens: 15 },
      },
      'content_filter',
    ],
  ] as const)('Responses %s时记为失败事件', async (_label, response, errorType) => {
    providerMocks.createResponse.mockResolvedValueOnce(response)
    const { userId, conversationId } = await createFixture()

    await title.maybeGenerateTitle(conversationId)

    const [conversation] = await dbClient.db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
    expect(conversation?.title).toBe('新聊天')

    const [log] = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.userId, userId))
    expect(log).toMatchObject({
      kind: 'title',
      success: false,
      errorType,
    })
  })

  it('上游请求异常时仍写失败事件并使用本地回退标题', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    providerMocks.createResponse.mockRejectedValueOnce(new Error('network down'))
    const { userId, conversationId } = await createFixture()

    await title.maybeGenerateTitle(conversationId)

    const [conversation] = await dbClient.db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
    expect(conversation?.title).toBe('新聊天')

    const [log] = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.userId, userId))
    expect(log).toMatchObject({
      kind: 'title',
      inputTokens: 0,
      totalTokens: 0,
      success: false,
      errorType: 'upstream_error',
    })
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('Chat Completions 内容过滤终态记为失败并使用本地回退标题', async () => {
    providerMocks.createChat.mockResolvedValueOnce({
      choices: [{ message: { content: null }, finish_reason: 'content_filter' }],
      usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 },
    })
    const { userId, conversationId, modelId } = await createFixture('chat')
    await appConfig.updateAppConfig({ titleModelId: modelId })

    await title.maybeGenerateTitle(conversationId)

    const [conversation] = await dbClient.db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
    expect(conversation?.title).toBe('新聊天')

    const [log] = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.userId, userId))
    expect(log).toMatchObject({
      kind: 'title',
      inputTokens: 20,
      totalTokens: 20,
      success: false,
      errorType: 'content_filter',
    })
  })

  it('Anthropic 拒绝终态记为失败并使用本地回退标题', async () => {
    providerMocks.createAnthropicMessage.mockResolvedValueOnce({
      content: [],
      stop_reason: 'refusal',
      usage: { input_tokens: 16, output_tokens: 0 },
    })
    const { userId, conversationId, modelId } = await createFixture('anthropic')
    await appConfig.updateAppConfig({ titleModelId: modelId })

    await title.maybeGenerateTitle(conversationId)

    const [conversation] = await dbClient.db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
    expect(conversation?.title).toBe('新聊天')

    const [log] = await dbClient.db
      .select()
      .from(schema.usageLogs)
      .where(eq(schema.usageLogs.userId, userId))
    expect(log).toMatchObject({
      kind: 'title',
      inputTokens: 16,
      totalTokens: 16,
      success: false,
      errorType: 'refusal',
    })
  })
})
