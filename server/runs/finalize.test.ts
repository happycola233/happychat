import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let finalize: typeof import('./finalize')

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-finalize-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-finalize'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  finalize = await import('./finalize')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

describe('finalizeRun timing snapshots', () => {
  it('stores generation and reasoning durations with the final message', async () => {
    const [user] = await dbClient.db
      .insert(schema.users)
      .values({ username: 'finalize-user', passwordHash: 'hash' })
      .returning()
    const [provider] = await dbClient.db
      .insert(schema.providers)
      .values({
        name: 'Finalize provider',
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
      })
      .returning()
    if (!user || !provider) throw new Error('Failed to create finalize fixtures')

    const [model] = await dbClient.db
      .insert(schema.models)
      .values({
        providerId: provider.id,
        modelId: 'finalize-model',
        displayName: 'Finalize model',
        capabilities: {
          vision: false,
          file_input: false,
          web_search: false,
          image_generation: false,
          reasoning: true,
        },
        allowedEfforts: [{ value: 'high', description: '深度思考' }],
        defaultEffort: 'high',
      })
      .returning()
    if (!model) throw new Error('Failed to create finalize model')

    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id, title: '已有标题', modelId: model.id })
      .returning()
    if (!conversation) throw new Error('Failed to create finalize conversation')
    const [assistantMessage] = await dbClient.db
      .insert(schema.messages)
      .values({
        conversationId: conversation.id,
        role: 'assistant',
        status: 'streaming',
        modelId: model.id,
        content: [],
      })
      .returning()
    if (!assistantMessage) throw new Error('Failed to create assistant message')

    const startedAt = new Date(Date.UTC(2026, 6, 17, 9, 0, 0))
    const [run] = await dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: conversation.id,
        userId: user.id,
        assistantMessageId: assistantMessage.id,
        modelId: model.id,
        state: 'running',
        requestParams: { reasoning_effort: 'high' },
        startedAt,
      })
      .returning()
    if (!run) throw new Error('Failed to create finalize run')
    await dbClient.db.insert(schema.runEvents).values([
      {
        runId: run.id,
        sequenceNumber: 0,
        type: 'response.created',
        data: {},
        createdAt: new Date(startedAt.getTime() + 1_000),
      },
      {
        runId: run.id,
        sequenceNumber: 1,
        type: 'response.output_text.delta',
        data: { delta: '回答' },
        createdAt: new Date(startedAt.getTime() + 4_500),
      },
    ])

    const emittedTypes: string[] = []
    await finalize.finalizeRun({
      run,
      assistantMessage,
      conversation,
      model,
      provider,
      state: 'completed',
      text: '回答',
      reasoningSummary: '思考摘要',
      annotations: [],
      usage: {
        inputTokens: 10,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        outputTokens: 5,
        reasoningTokens: 2,
        totalTokens: 15,
      },
      incompleteReason: null,
      errorMessage: null,
      upstreamResponseId: null,
      startedAt,
      persistEmit: (type) => {
        emittedTypes.push(type)
        return emittedTypes.length - 1
      },
    })

    const persistedRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, run.id),
    })
    const persistedMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, assistantMessage.id),
    })
    expect(persistedRun?.finishedAt).toBeInstanceOf(Date)
    expect(persistedMessage).toMatchObject({
      status: 'complete',
      reasoningDurationMs: 3_500,
      generationDurationMs: persistedRun!.finishedAt!.getTime() - startedAt.getTime(),
    })
    expect(emittedTypes).toEqual(['run.done'])
  })
})
