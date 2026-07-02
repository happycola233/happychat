import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let stats: typeof import('./stats')

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
let uniqueId = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-stats-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-stats'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  stats = await import('./stats')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

async function insertUsageLog(
  createdAt: number,
  values: Partial<typeof schema.usageLogs.$inferInsert> = {},
) {
  await dbClient.db.insert(schema.usageLogs).values({ ...values, createdAt: new Date(createdAt) })
}

async function insertUser(lastActiveAt?: number) {
  const [user] = await dbClient.db
    .insert(schema.users)
    .values({
      username: `stats_user_${Date.now()}_${uniqueId++}`,
      passwordHash: 'test-password-hash',
      lastActiveAt: lastActiveAt === undefined ? null : new Date(lastActiveAt),
    })
    .returning()
  if (!user) throw new Error('failed to insert test user')
  return user
}

describe('stats time buckets', () => {
  it('groups multiple usage logs into the same day bucket', async () => {
    const dayStart = Date.UTC(2026, 5, 17)
    await insertUsageLog(dayStart + HOUR_MS)
    await insertUsageLog(dayStart + 2 * HOUR_MS)
    await insertUsageLog(dayStart + 10 * HOUR_MS)
    await insertUsageLog(dayStart + DAY_MS + HOUR_MS)

    const analytics = await stats.getAnalytics({
      bucket: 'day',
      from: dayStart,
      to: dayStart + 2 * DAY_MS,
    })

    expect(analytics.series.map((p) => ({ ts: p.ts, requests: p.requests }))).toEqual([
      { ts: dayStart, requests: 3 },
      { ts: dayStart + DAY_MS, requests: 1 },
    ])
  })

  it('groups overview health data into the same hour bucket', async () => {
    const hourStart = Date.UTC(2026, 5, 19, 8)
    await insertUsageLog(hourStart + 5 * 60_000)
    await insertUsageLog(hourStart + 45 * 60_000)
    await insertUsageLog(hourStart + HOUR_MS + 5 * 60_000)

    const overview = await stats.getOverview({
      bucket: 'hour',
      from: hourStart,
      to: hourStart + 2 * HOUR_MS,
    })

    expect(overview.healthTimeline.map((p) => ({ ts: p.ts, requests: p.requests }))).toEqual([
      { ts: hourStart, requests: 2 },
      { ts: hourStart + HOUR_MS, requests: 1 },
    ])
  })
})

describe('user stats activity', () => {
  it('uses usage log time when account lastActiveAt has never been written', async () => {
    const usageAt = Date.UTC(2026, 5, 21, 1, 35, 51)
    const user = await insertUser()
    await insertUsageLog(usageAt, { userId: user.id, modelLabel: 'gpt-5.5', totalTokens: 39430 })

    const [stat] = await stats.getUserStats({ userId: user.id })

    expect(stat?.lastActive).toBe(usageAt)
  })

  it('uses the latest matching usage log instead of an older login time', async () => {
    const loginAt = Date.UTC(2026, 5, 24, 15, 44, 41)
    const firstUsageAt = Date.UTC(2026, 5, 26, 13, 48, 0)
    const latestUsageAt = Date.UTC(2026, 5, 26, 15, 5, 30)
    const user = await insertUser(loginAt)
    await insertUsageLog(firstUsageAt, { userId: user.id, modelLabel: 'gpt-5.5', totalTokens: 43026 })
    await insertUsageLog(latestUsageAt, { userId: user.id, modelLabel: 'gpt-5.5', totalTokens: 26722 })

    const [stat] = await stats.getUserStats({ userId: user.id })

    expect(stat?.lastActive).toBe(latestUsageAt)
  })
})

describe('usage event duration', () => {
  it('returns the run wall-clock duration for request events', async () => {
    const user = await insertUser()
    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId: user.id })
      .returning()
    if (!conversation) throw new Error('failed to insert test conversation')

    const startedAt = Date.UTC(2026, 6, 1, 8, 0, 0)
    const finishedAt = startedAt + 5_400
    const [run] = await dbClient.db
      .insert(schema.runs)
      .values({
        conversationId: conversation.id,
        userId: user.id,
        state: 'completed',
        startedAt: new Date(startedAt),
        finishedAt: new Date(finishedAt),
      })
      .returning()
    if (!run) throw new Error('failed to insert test run')

    await insertUsageLog(finishedAt, { userId: user.id, runId: run.id })

    const result = await stats.listUsageEvents({ userId: user.id })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.durationMs).toBe(5_400)
  })

  it('returns null when an audit log no longer has an associated run', async () => {
    const user = await insertUser()
    await insertUsageLog(Date.UTC(2026, 6, 1, 9), { userId: user.id })

    const result = await stats.listUsageEvents({ userId: user.id })

    expect(result.items[0]?.durationMs).toBeNull()
  })
})
