import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
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

async function insertProvider(name: string) {
  const [provider] = await dbClient.db
    .insert(schema.providers)
    .values({
      name,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-api-key',
    })
    .returning()
  if (!provider) throw new Error('failed to insert test provider')
  return provider
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

  it('aggregates and returns cache writes independently from cache reads', async () => {
    const hourStart = Date.UTC(2027, 0, 5, 8)
    await insertUsageLog(hourStart + 10_000, {
      inputTokens: 1_000,
      cacheWriteTokens: 600,
      cachedTokens: 300,
      outputTokens: 100,
      totalTokens: 1_100,
    })

    const analytics = await stats.getAnalytics({
      bucket: 'hour',
      from: hourStart,
      to: hourStart + HOUR_MS,
    })
    const events = await stats.listUsageEvents({ from: hourStart, to: hourStart + HOUR_MS })

    expect(analytics.series).toEqual([
      expect.objectContaining({
        inputTokens: 1_000,
        cacheWriteTokens: 600,
        cachedTokens: 300,
      }),
    ])
    expect(events.items[0]).toEqual(
      expect.objectContaining({ cacheWriteTokens: 600, cachedTokens: 300 }),
    )
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

describe('usage event provider labels', () => {
  it('uses the current provider name while the provider still exists', async () => {
    const provider = await insertProvider('Original Provider')
    await insertUsageLog(Date.UTC(2026, 6, 2, 8), {
      providerId: provider.id,
      providerLabel: provider.name,
    })

    await dbClient.db
      .update(schema.providers)
      .set({ name: 'Renamed Provider' })
      .where(eq(schema.providers.id, provider.id))

    const result = await stats.listUsageEvents({ providerId: provider.id })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.providerLabel).toBe('Renamed Provider')
  })

  it('falls back to the usage log snapshot after the provider is deleted', async () => {
    const user = await insertUser()
    const provider = await insertProvider('Deleted Provider')
    await insertUsageLog(Date.UTC(2026, 6, 2, 9), {
      userId: user.id,
      providerId: provider.id,
      providerLabel: provider.name,
    })

    await dbClient.db
      .update(schema.usageLogs)
      .set({ providerId: null })
      .where(eq(schema.usageLogs.providerId, provider.id))
    await dbClient.db.delete(schema.providers).where(eq(schema.providers.id, provider.id))

    const result = await stats.listUsageEvents({ userId: user.id })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.providerId).toBeNull()
    expect(result.items[0]?.providerLabel).toBe('Deleted Provider')
  })
})

describe('cache-write cost integration', () => {
  it('uses cache-write pricing across overview, analytics, user stats and events', async () => {
    const hourStart = Date.UTC(2027, 0, 6, 8)
    const user = await insertUser()
    const provider = await insertProvider('Cache Cost Provider')
    const [model] = await dbClient.db
      .insert(schema.models)
      .values({
        providerId: provider.id,
        modelId: `cache-cost-model-${uniqueId++}`,
        displayName: 'Cache Cost Model',
        capabilities: {
          vision: false,
          file_input: false,
          web_search: false,
          image_generation: false,
          reasoning: false,
        },
        pricing: { input: 2.5, cacheWriteInput: 3.125, cachedInput: 0.25, output: 10 },
      })
      .returning()
    if (!model) throw new Error('failed to insert test model')

    await insertUsageLog(hourStart + 10_000, {
      userId: user.id,
      providerId: provider.id,
      modelId: model.id,
      inputTokens: 1_000_000,
      cacheWriteTokens: 300_000,
      cachedTokens: 200_000,
      outputTokens: 500_000,
      totalTokens: 1_500_000,
    })
    const filter = { from: hourStart, to: hourStart + HOUR_MS, userId: user.id }

    const [overview, analytics, userStats, events] = await Promise.all([
      stats.getOverview(filter),
      stats.getAnalytics({ ...filter, bucket: 'hour' }),
      stats.getUserStats(filter),
      stats.listUsageEvents(filter),
    ])

    expect(overview.totals.costUsd).toBeCloseTo(7.2375, 6)
    expect(analytics.series[0]?.costUsd).toBeCloseTo(7.2375, 6)
    expect(userStats[0]?.costUsd).toBeCloseTo(7.2375, 6)
    expect(events.items[0]?.costUsd).toBeCloseTo(7.2375, 6)
  })
})
