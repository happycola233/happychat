import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UsageLogDTO } from '@shared/types/api'
import type { ModelPricing } from '@shared/types/domain'

const temporaryRoot = resolve('.tmp')
const modelId = 'stats-generated-images-model'
const providerId = 'stats-generated-images-provider'
const pricing: ModelPricing = {
  input: 2,
  cacheWriteInput: 3,
  cachedInput: 0.5,
  output: 8,
  image: 4,
}

let temporaryDirectory: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let stats: typeof import('./stats')
let fixtureSequence = 0

beforeAll(async () => {
  mkdirSync(temporaryRoot, { recursive: true })
  temporaryDirectory = mkdtempSync(join(temporaryRoot, 'stats-generated-images-'))
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('DATA_DIR', temporaryDirectory)
  vi.stubEnv('DATABASE_URL', join(temporaryDirectory, 'test.db'))
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-stats-generated-images')
  vi.resetModules()

  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  migration.runMigrations()
  stats = await import('./stats')
  await dbClient.db.insert(schema.providers).values({
    id: providerId,
    name: 'Generated image stats provider',
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
  })
  await dbClient.db.insert(schema.models).values({
    id: modelId,
    providerId,
    modelId: 'responses-test',
    displayName: 'Responses test',
    kind: 'responses',
    capabilities: {
      vision: true,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
    },
  })
})

afterAll(() => {
  dbClient?.sqlite.close()
  vi.unstubAllEnvs()
  if (temporaryDirectory) {
    expect(dirname(resolve(temporaryDirectory))).toBe(temporaryRoot)
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

async function createRequestFixture(generatedImageCount = 2) {
  const prefix = `generated-images-${fixtureSequence++}`
  const userId = `${prefix}-user`
  const conversationId = `${prefix}-conversation`
  const messageId = `${prefix}-assistant`
  const runId = `${prefix}-run`
  const eventId = `${prefix}-event`
  await dbClient.db.insert(schema.users).values({
    id: userId,
    username: userId,
    passwordHash: 'test-hash',
  })
  await dbClient.db.insert(schema.conversations).values({ id: conversationId, userId })
  await dbClient.db.insert(schema.messages).values({
    id: messageId,
    conversationId,
    role: 'assistant',
    runId,
    content: [
      { type: 'output_text', text: '测试输出' },
      ...Array.from({ length: generatedImageCount }, (_, index) => ({
        type: 'image_result' as const,
        attachment_id: `${prefix}-image-${index}`,
      })),
    ],
  })
  await dbClient.db.insert(schema.runs).values({
    id: runId,
    conversationId,
    userId,
    modelId,
    assistantMessageId: messageId,
    state: 'completed',
  })
  await dbClient.db.insert(schema.usageLogs).values({
    id: eventId,
    runId,
    userId,
    conversationId,
    modelId,
    providerId,
    kind: 'chat',
    generatedImageCount,
    inputTokens: 1000,
    cacheWriteTokens: 200,
    cachedTokens: 100,
    outputTokens: 300,
    reasoningTokens: 75,
    totalTokens: 1300,
    imageTokens: generatedImageCount ? 400 : 0,
    pricingSnapshot: pricing,
  })
  return { eventId, conversationId, userId }
}

function auditMetrics(event: UsageLogDTO) {
  return {
    kind: event.kind,
    generatedImageCount: event.generatedImageCount,
    inputTokens: event.inputTokens,
    cacheWriteTokens: event.cacheWriteTokens,
    cachedTokens: event.cachedTokens,
    outputTokens: event.outputTokens,
    reasoningTokens: event.reasoningTokens,
    totalTokens: event.totalTokens,
    imageTokens: event.imageTokens,
    costUsd: event.costUsd,
  }
}

describe('request event generated image statistics', () => {
  it('returns actual generated-image count for Responses even when model image generation is disabled', async () => {
    const fixture = await createRequestFixture()
    const result = await stats.listUsageEvents({ userId: fixture.userId })
    expect(result.items).toHaveLength(1)
    expect(auditMetrics(result.items[0]!)).toMatchObject({
      kind: 'chat',
      generatedImageCount: 2,
      inputTokens: 1000,
      cacheWriteTokens: 200,
      cachedTokens: 100,
      outputTokens: 300,
      reasoningTokens: 75,
      totalTokens: 1300,
      imageTokens: 400,
    })
    expect(result.items[0]!.costUsd).toBeCloseTo(0.00605, 10)
  })

  it('keeps text and title requests at zero images without changing their request kind or accounting', async () => {
    const fixture = await createRequestFixture(0)
    const titleEventId = `${fixture.eventId}-title`
    await dbClient.db.insert(schema.usageLogs).values({
      id: titleEventId,
      userId: fixture.userId,
      conversationId: fixture.conversationId,
      modelId,
      providerId,
      kind: 'title',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      pricingSnapshot: pricing,
    })

    const result = await stats.listUsageEvents({ userId: fixture.userId })
    const text = result.items.find((event) => event.id === fixture.eventId)!
    const title = result.items.find((event) => event.id === titleEventId)!
    expect(text).toMatchObject({ kind: 'chat', generatedImageCount: 0, totalTokens: 1300 })
    expect(text.costUsd).toBeCloseTo(0.00445, 10)
    expect(title).toMatchObject({
      kind: 'title',
      generatedImageCount: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      imageTokens: 0,
    })
    expect(title.costUsd).toBeCloseTo(0.00006, 10)
  })

  it('preserves image count, request kind, tokens and cost after deleting the source conversation', async () => {
    const fixture = await createRequestFixture()
    const before = await stats.listUsageEvents({ userId: fixture.userId })
    const { deleteConversations } = await import('./conversations')
    expect(await deleteConversations(fixture.userId, [fixture.conversationId])).toBe(1)

    const after = await stats.listUsageEvents({ userId: fixture.userId })
    expect(after.items).toHaveLength(1)
    expect(after.items[0]).toMatchObject({
      id: fixture.eventId,
      runId: null,
      generatedImageCount: 2,
    })
    expect(auditMetrics(after.items[0]!)).toEqual(auditMetrics(before.items[0]!))
  })
})
