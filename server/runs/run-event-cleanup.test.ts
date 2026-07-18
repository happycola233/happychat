import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asc } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let cleanup: typeof import('./run-event-cleanup')

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-run-event-cleanup-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-run-event-cleanup'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  cleanup = await import('./run-event-cleanup')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

describe('sanitizePersistedRunEvents', () => {
  it('sanitizes historical ciphertext once and is idempotent', async () => {
    const [user] = await dbClient.db
      .insert(schema.users)
      .values({ username: 'cleanup-user', passwordHash: 'hash' })
      .returning()
    if (!user) throw new Error('failed to create user fixture')

    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id })
      .returning()
    if (!conversation) throw new Error('failed to create conversation fixture')

    const [run] = await dbClient.db
      .insert(schema.runs)
      .values({ conversationId: conversation.id, userId: user.id, state: 'completed' })
      .returning()
    if (!run) throw new Error('failed to create run fixture')

    await dbClient.db.insert(schema.runEvents).values([
      {
        runId: run.id,
        sequenceNumber: 0,
        type: 'response.output_item.done',
        data: {
          item: { type: 'reasoning', encrypted_content: 'historical-ciphertext' },
        },
      },
      {
        runId: run.id,
        sequenceNumber: 1,
        type: 'response.completed',
        data: {
          response: {
            output: [{ type: 'reasoning', encrypted_content: null }],
          },
        },
      },
    ])

    expect(cleanup.sanitizePersistedRunEvents()).toBe(1)
    const afterFirstRun = await dbClient.db
      .select({ data: schema.runEvents.data })
      .from(schema.runEvents)
      .orderBy(asc(schema.runEvents.sequenceNumber))

    expect(cleanup.sanitizePersistedRunEvents()).toBe(0)
    const afterSecondRun = await dbClient.db
      .select({ data: schema.runEvents.data })
      .from(schema.runEvents)
      .orderBy(asc(schema.runEvents.sequenceNumber))

    expect(afterSecondRun).toEqual(afterFirstRun)
    expect(afterFirstRun).toEqual([
      {
        data: {
          item: {
            type: 'reasoning',
            encrypted_content: null,
            encrypted_content_omitted: true,
          },
        },
      },
      {
        data: {
          response: { output: [{ type: 'reasoning', encrypted_content: null }] },
        },
      },
    ])
  })
})
