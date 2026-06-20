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

async function insertUsageLog(createdAt: number) {
  await dbClient.db.insert(schema.usageLogs).values({ createdAt: new Date(createdAt) })
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
