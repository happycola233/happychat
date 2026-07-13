import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let storage: typeof import('../storage/files')
let cleanupService: typeof import('./attachment-cleanup')
let conversationService: typeof import('./conversations')
let fixtureSequence = 0

const NOW = new Date('2026-07-13T12:00:00.000Z')

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-attachment-cleanup-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-attachment-cleanup'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  storage = await import('../storage/files')
  cleanupService = await import('./attachment-cleanup')
  conversationService = await import('./conversations')
  migration.runMigrations()
})

beforeEach(() => {
  dbClient.sqlite.exec('DELETE FROM users')
  rmSync(join(tmpDir, 'uploads'), { recursive: true, force: true })
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

async function createUser(): Promise<string> {
  const sequence = fixtureSequence++
  const userId = `cleanup-user-${sequence}`
  await dbClient.db.insert(schema.users).values({
    id: userId,
    username: `cleanup-user-${sequence}`,
    passwordHash: 'hash',
  })
  return userId
}

async function createAttachment(args: {
  userId: string
  createdAt: Date
  messageId?: string | null
  filename?: string
}) {
  const sequence = fixtureSequence++
  const id = `cleanup-attachment-${sequence}`
  const filename = args.filename ?? `${id}.txt`
  const bytes = Buffer.from(`attachment-${sequence}`)
  const storagePath = storage.saveUpload(args.userId, id, filename, 'text/plain', bytes)

  await dbClient.db.insert(schema.attachments).values({
    id,
    userId: args.userId,
    messageId: args.messageId,
    kind: 'file',
    mime: 'text/plain',
    filename,
    byteSize: bytes.length,
    storagePath,
    createdAt: args.createdAt,
  })

  return { id, storagePath }
}

describe('expired orphan attachment cleanup', () => {
  it('deletes unbound uploads at the 24-hour boundary and preserves newer or bound files', async () => {
    const userId = await createUser()
    const cutoff = new Date(NOW.getTime() - cleanupService.ORPHAN_ATTACHMENT_RETENTION_MS)
    const expired = await createAttachment({ userId, createdAt: cutoff })
    const fresh = await createAttachment({
      userId,
      createdAt: new Date(cutoff.getTime() + 1),
    })
    const bound = await createAttachment({
      userId,
      createdAt: new Date(cutoff.getTime() - 1),
      messageId: 'bound-message',
    })

    const result = await cleanupService.cleanupExpiredOrphanAttachments({ now: NOW })

    expect(result).toEqual({
      deletedCount: 1,
      repairedReferenceCount: 0,
      failedCount: 0,
      failures: [],
    })
    expect(existsSync(expired.storagePath)).toBe(false)
    expect(existsSync(fresh.storagePath)).toBe(true)
    expect(existsSync(bound.storagePath)).toBe(true)
    const remainingIds = dbClient.sqlite
      .prepare('select id from attachments order by id')
      .all()
      .map((row) => (row as { id: string }).id)
    expect(remainingIds).toEqual([bound.id, fresh.id].sort())
  })

  it('continues beyond 1000 items while leaving an early failure retryable', async () => {
    const userId = await createUser()
    const expiredAt = new Date(NOW.getTime() - cleanupService.ORPHAN_ATTACHMENT_RETENTION_MS - 1)
    const rows = Array.from({ length: 1_001 }, (_, index) => {
      const id = `cleanup-backlog-${index.toString().padStart(4, '0')}`
      return {
        id,
        userId,
        kind: 'file' as const,
        mime: 'text/plain',
        filename: `${id}.txt`,
        byteSize: 0,
        // 文件缺失也应能清掉 DB 行；使用受管目录内路径避免绕过安全边界。
        storagePath: join(tmpDir, 'uploads', userId, `${id}.txt`),
        createdAt: expiredAt,
      }
    })
    for (let offset = 0; offset < rows.length; offset += 200) {
      await dbClient.db.insert(schema.attachments).values(rows.slice(offset, offset + 200))
    }

    const failingPath = rows[0]!.storagePath
    const firstResult = await cleanupService.cleanupExpiredOrphanAttachments({
      now: NOW,
      removeFile: (storagePath) => {
        if (storagePath === failingPath) throw new Error('simulated first-page failure')
        storage.removeUploadStrict(storagePath)
      },
    })

    expect(firstResult).toMatchObject({
      deletedCount: 1_000,
      failedCount: 1,
      failures: [
        {
          attachmentId: 'cleanup-backlog-0000',
          operation: 'delete',
          error: expect.any(Error),
        },
      ],
    })
    expect(
      await dbClient.db.select({ id: schema.attachments.id }).from(schema.attachments),
    ).toEqual([{ id: 'cleanup-backlog-0000' }])

    const retryResult = await cleanupService.cleanupExpiredOrphanAttachments({ now: NOW })
    expect(retryResult).toMatchObject({ deletedCount: 1, failedCount: 0 })
  })

  it('repairs historical null-messageId rows that are still referenced by message content', async () => {
    const userId = await createUser()
    const expired = await createAttachment({
      userId,
      createdAt: new Date(NOW.getTime() - cleanupService.ORPHAN_ATTACHMENT_RETENTION_MS - 1),
    })
    const conversationId = `cleanup-conversation-${fixtureSequence++}`
    const messageId = `cleanup-message-${fixtureSequence++}`
    await dbClient.db.insert(schema.conversations).values({ id: conversationId, userId })
    await dbClient.db.insert(schema.messages).values({
      id: messageId,
      conversationId,
      role: 'user',
      content: [{ type: 'input_file', attachment_id: expired.id, filename: 'history.txt' }],
    })

    const repairedResult = await cleanupService.cleanupExpiredOrphanAttachments({ now: NOW })

    expect(repairedResult).toEqual({
      deletedCount: 0,
      repairedReferenceCount: 1,
      failedCount: 0,
      failures: [],
    })
    expect(existsSync(expired.storagePath)).toBe(true)
    expect(
      await dbClient.db
        .select({ messageId: schema.attachments.messageId })
        .from(schema.attachments)
        .where(eq(schema.attachments.id, expired.id))
        .then((rows) => rows[0]?.messageId),
    ).toBe(messageId)

    // 修复归属后，正常会话删除路径会同步清理附件。
    expect(await conversationService.deleteConversations(userId, [conversationId])).toBe(1)
    expect(existsSync(expired.storagePath)).toBe(false)
  })

  it('protects a historical orphan referenced by multiple conversations until one remains', async () => {
    const userId = await createUser()
    const expired = await createAttachment({
      userId,
      createdAt: new Date(NOW.getTime() - cleanupService.ORPHAN_ATTACHMENT_RETENTION_MS - 1),
    })
    const firstConversationId = `cleanup-conversation-${fixtureSequence++}`
    const secondConversationId = `cleanup-conversation-${fixtureSequence++}`
    const firstMessageId = `cleanup-message-${fixtureSequence++}`
    const secondMessageId = `cleanup-message-${fixtureSequence++}`
    await dbClient.db.insert(schema.conversations).values([
      { id: firstConversationId, userId },
      { id: secondConversationId, userId },
    ])
    const content = [
      { type: 'input_file' as const, attachment_id: expired.id, filename: 'shared-history.txt' },
    ]
    await dbClient.db.insert(schema.messages).values([
      {
        id: firstMessageId,
        conversationId: firstConversationId,
        role: 'user',
        content,
      },
      {
        id: secondMessageId,
        conversationId: secondConversationId,
        role: 'user',
        content,
      },
    ])

    const protectedResult = await cleanupService.cleanupExpiredOrphanAttachments({ now: NOW })

    expect(protectedResult).toMatchObject({
      deletedCount: 0,
      repairedReferenceCount: 0,
      failedCount: 0,
    })
    expect(existsSync(expired.storagePath)).toBe(true)
    expect(
      await dbClient.db
        .select({ messageId: schema.attachments.messageId })
        .from(schema.attachments)
        .where(eq(schema.attachments.id, expired.id))
        .then((rows) => rows[0]?.messageId),
    ).toBeNull()

    expect(await conversationService.deleteConversations(userId, [firstConversationId])).toBe(1)
    expect(existsSync(expired.storagePath)).toBe(true)

    const repairedResult = await cleanupService.cleanupExpiredOrphanAttachments({ now: NOW })
    expect(repairedResult).toMatchObject({ deletedCount: 0, repairedReferenceCount: 1 })
    expect(await conversationService.deleteConversations(userId, [secondConversationId])).toBe(1)
    expect(existsSync(expired.storagePath)).toBe(false)
  })

  it('keeps failed filesystem deletions retryable without blocking other attachments', async () => {
    const userId = await createUser()
    const expiredAt = new Date(NOW.getTime() - cleanupService.ORPHAN_ATTACHMENT_RETENTION_MS - 1)
    const failing = await createAttachment({ userId, createdAt: expiredAt })
    const successful = await createAttachment({ userId, createdAt: expiredAt })

    const firstResult = await cleanupService.cleanupExpiredOrphanAttachments({
      now: NOW,
      removeFile: (storagePath) => {
        if (storagePath === failing.storagePath) throw new Error('simulated unlink failure')
        storage.removeUploadStrict(storagePath)
      },
    })

    expect(firstResult).toMatchObject({
      deletedCount: 1,
      repairedReferenceCount: 0,
      failedCount: 1,
      failures: [
        {
          attachmentId: failing.id,
          operation: 'delete',
          error: expect.any(Error),
        },
      ],
    })
    expect(existsSync(failing.storagePath)).toBe(true)
    expect(existsSync(successful.storagePath)).toBe(false)
    expect(
      await dbClient.db
        .select({ id: schema.attachments.id })
        .from(schema.attachments)
        .where(eq(schema.attachments.id, failing.id)),
    ).toHaveLength(1)

    const retryResult = await cleanupService.cleanupExpiredOrphanAttachments({ now: NOW })
    expect(retryResult).toMatchObject({ deletedCount: 1, failedCount: 0 })
    expect(existsSync(failing.storagePath)).toBe(false)
  })

  it('removes stale DB rows even when the disk file is already missing', async () => {
    const userId = await createUser()
    const expired = await createAttachment({
      userId,
      createdAt: new Date(NOW.getTime() - cleanupService.ORPHAN_ATTACHMENT_RETENTION_MS - 1),
    })
    storage.removeUploadStrict(expired.storagePath)

    const result = await cleanupService.cleanupExpiredOrphanAttachments({ now: NOW })

    expect(result.deletedCount).toBe(1)
    expect(
      await dbClient.db
        .select({ id: schema.attachments.id })
        .from(schema.attachments)
        .where(eq(schema.attachments.id, expired.id)),
    ).toHaveLength(0)
  })

  it('refuses to unlink a polluted DB path outside the managed uploads directory', async () => {
    const userId = await createUser()
    const id = `outside-attachment-${fixtureSequence++}`
    const outsidePath = join(tmpDir, `${id}.txt`)
    writeFileSync(outsidePath, 'must stay')
    await dbClient.db.insert(schema.attachments).values({
      id,
      userId,
      kind: 'file',
      mime: 'text/plain',
      filename: `${id}.txt`,
      byteSize: 9,
      storagePath: outsidePath,
      createdAt: new Date(NOW.getTime() - cleanupService.ORPHAN_ATTACHMENT_RETENTION_MS - 1),
    })

    const result = await cleanupService.cleanupExpiredOrphanAttachments({ now: NOW })

    expect(result).toMatchObject({ deletedCount: 0, failedCount: 1 })
    expect(existsSync(outsidePath)).toBe(true)
    expect(
      await dbClient.db
        .select({ id: schema.attachments.id })
        .from(schema.attachments)
        .where(eq(schema.attachments.id, id)),
    ).toHaveLength(1)
  })
})

describe('orphan attachment cleanup scheduler', () => {
  it('runs immediately, continues after an error, and stops future intervals', async () => {
    vi.useFakeTimers()
    try {
      const emptyResult = {
        deletedCount: 0,
        repairedReferenceCount: 0,
        failedCount: 0,
        failures: [],
      }
      const cleanup = vi
        .fn(async () => emptyResult)
        .mockRejectedValueOnce(new Error('simulated sweep failure'))
      const logger = { log: vi.fn(), error: vi.fn() }

      const stop = cleanupService.startOrphanAttachmentCleanupScheduler({
        cleanup,
        intervalMs: 1_000,
        logger,
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(cleanup).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledWith('孤立附件清理失败：', expect.any(Error))

      await vi.advanceTimersByTimeAsync(1_000)
      expect(cleanup).toHaveBeenCalledTimes(2)

      stop()
      await vi.advanceTimersByTimeAsync(3_000)
      expect(cleanup).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not overlap sweeps when one run exceeds the interval', async () => {
    vi.useFakeTimers()
    try {
      const emptyResult = {
        deletedCount: 0,
        repairedReferenceCount: 0,
        failedCount: 0,
        failures: [],
      }
      let finishFirstRun: ((result: typeof emptyResult) => void) | undefined
      const firstRun = new Promise<typeof emptyResult>((resolve) => {
        finishFirstRun = resolve
      })
      const cleanup = vi.fn(() => firstRun)
      const stop = cleanupService.startOrphanAttachmentCleanupScheduler({
        cleanup,
        intervalMs: 1_000,
        logger: { log: vi.fn(), error: vi.fn() },
      })

      await vi.advanceTimersByTimeAsync(3_000)
      expect(cleanup).toHaveBeenCalledTimes(1)

      finishFirstRun?.(emptyResult)
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(cleanup).toHaveBeenCalledTimes(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
