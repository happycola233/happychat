import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let manager: typeof import('./manager')

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-manager-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-manager'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  manager = await import('./manager')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

describe('recoverInterruptedRuns', () => {
  it('clears an untrusted replay context left by an interrupted finalization', async () => {
    const [user] = await dbClient.db
      .insert(schema.users)
      .values({ username: 'manager-user', passwordHash: 'hash' })
      .returning()
    const [provider] = await dbClient.db
      .insert(schema.providers)
      .values({ name: 'Manager provider', baseUrl: 'https://example.test/v1', apiKey: 'key' })
      .returning()
    if (!user || !provider) throw new Error('Failed to create manager fixtures')
    const [model] = await dbClient.db
      .insert(schema.models)
      .values({
        providerId: provider.id,
        modelId: 'gpt-manager',
        displayName: 'Manager model',
        replayReasoning: true,
        capabilities: {
          vision: false,
          file_input: false,
          web_search: false,
          image_generation: false,
          reasoning: true,
        },
        allowedEfforts: ['medium'],
        defaultEffort: 'medium',
      })
      .returning()
    if (!model) throw new Error('Failed to create manager model')
    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id, modelId: model.id })
      .returning()
    if (!conversation) throw new Error('Failed to create manager conversation')
    const [message] = await dbClient.db
      .insert(schema.messages)
      .values({
        conversationId: conversation.id,
        role: 'assistant',
        status: 'streaming',
        modelId: model.id,
        content: [],
        reasoningReplayContext: {
          version: 1,
          source: {
            providerId: provider.id,
            providerBaseUrl: provider.baseUrl,
            upstreamModelId: model.modelId,
          },
          reasoningContext: null,
          items: [{ type: 'reasoning', encrypted_content: 'opaque-interrupted-ciphertext' }],
        },
      })
      .returning()
    if (!message) throw new Error('Failed to create manager message')
    const [run] = await dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: conversation.id,
        userId: user.id,
        assistantMessageId: message.id,
        modelId: model.id,
        state: 'running',
        requestParams: { reasoning_effort: 'medium' },
        startedAt: new Date(),
      })
      .returning()
    if (!run) throw new Error('Failed to create manager run')

    await manager.recoverInterruptedRuns()

    const recoveredRun = await dbClient.db.query.runs.findFirst({
      where: eq(schema.runs.id, run.id),
    })
    const recoveredMessage = await dbClient.db.query.messages.findFirst({
      where: eq(schema.messages.id, message.id),
    })
    expect(recoveredRun?.state).toBe('interrupted')
    expect(recoveredMessage).toMatchObject({
      status: 'interrupted',
      reasoningReplayContext: null,
    })
  })
})
