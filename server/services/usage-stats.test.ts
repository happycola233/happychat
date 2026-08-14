import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModelPricing } from '@shared/types/domain'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let usageStats: typeof import('./usage-stats')
let fixtureSeq = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-usage-stats-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-usage-stats'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  usageStats = await import('./usage-stats')
  migration.runMigrations()
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

const PRICING: ModelPricing = { input: 1_000_000 }
const DAY_MS = 86_400_000

async function createUser() {
  const n = fixtureSeq++
  const id = `usage-user-${n}`
  await dbClient.db
    .insert(schema.users)
    .values({ id, username: `usage-user-${n}`, passwordHash: 'hash' })
  return id
}

async function logUsage(
  userId: string,
  options: {
    at: Date
    modelLabel?: string
    tokens?: number
    success?: boolean
    imageTokens?: number
  },
) {
  await dbClient.db.insert(schema.usageLogs).values({
    userId,
    modelLabel: options.modelLabel ?? 'gpt-test',
    pricingSnapshot: PRICING,
    inputTokens: options.tokens ?? 1,
    totalTokens: options.tokens ?? 1,
    imageTokens: options.imageTokens ?? 0,
    success: options.success ?? true,
    createdAt: options.at,
  })
}

describe('个人使用情况统计', () => {
  it('热力图按用户本地日分格（东八区凌晨算当天）', async () => {
    const userId = await createUser()
    // UTC 2026-03-14T17:30Z = 东八区 3/15 01:30
    await logUsage(userId, { at: new Date('2026-03-14T17:30:00Z') })

    const utc = await usageStats.getMyUsageStats(userId, { tzOffsetMinutes: 0, days: 730 })
    const east = await usageStats.getMyUsageStats(userId, { tzOffsetMinutes: 480, days: 730 })
    const activeDate = (stats: typeof utc) =>
      stats.heatmap.find((cell) => cell.requests > 0)?.date ?? null

    expect(activeDate(utc)).toBe('2026-03-14')
    expect(activeDate(east)).toBe('2026-03-15')
  })

  it('负偏移时区同样正确分格', async () => {
    const userId = await createUser()
    // UTC 2026-03-15T02:00Z = 美东（-5）3/14 21:00
    await logUsage(userId, { at: new Date('2026-03-15T02:00:00Z') })
    const stats = await usageStats.getMyUsageStats(userId, { tzOffsetMinutes: -300, days: 730 })
    expect(stats.heatmap.find((cell) => cell.requests > 0)?.date).toBe('2026-03-14')
  })

  it('热力图补齐无活动的空白格，长度等于所选天数', async () => {
    const userId = await createUser()
    await logUsage(userId, { at: new Date() })
    const stats = await usageStats.getMyUsageStats(userId, { days: 30 })
    expect(stats.rangeDays).toBe(30)
    expect(stats.heatmap).toHaveLength(30)
    expect(stats.heatmap.filter((cell) => cell.requests > 0)).toHaveLength(1)
  })

  it('失败请求不计入统计', async () => {
    const userId = await createUser()
    await logUsage(userId, { at: new Date(), success: false })
    const stats = await usageStats.getMyUsageStats(userId, { days: 30 })
    expect(stats.totals.requests).toBe(0)
    expect(stats.totals.activeDays).toBe(0)
  })

  it('汇总请求数/Token/成本，并给出最常用模型', async () => {
    const userId = await createUser()
    const now = new Date()
    await logUsage(userId, { at: now, modelLabel: 'model-a', tokens: 3 })
    await logUsage(userId, { at: now, modelLabel: 'model-a', tokens: 2 })
    await logUsage(userId, { at: now, modelLabel: 'model-b', tokens: 10 })

    const stats = await usageStats.getMyUsageStats(userId, { days: 30 })
    expect(stats.totals.requests).toBe(3)
    expect(stats.totals.totalTokens).toBe(15)
    // 价格快照为 $1/token，因此成本恰好等于 token 数
    expect(stats.totals.costUsd).toBeCloseTo(15)
    expect(stats.topModel?.modelLabel).toBe('model-a')
    expect(stats.topModel?.requests).toBe(2)
    expect(stats.byModel).toHaveLength(2)
  })

  it('统计连续活跃天数（今天没用时从昨天开始算）', async () => {
    const userId = await createUser()
    const now = Date.now()
    for (const offset of [1, 2, 3, 7]) {
      await logUsage(userId, { at: new Date(now - offset * DAY_MS) })
    }
    const stats = await usageStats.getMyUsageStats(userId, { tzOffsetMinutes: 0, days: 30 })
    expect(stats.totals.activeDays).toBe(4)
    expect(stats.totals.currentStreak).toBe(3)
    expect(stats.totals.longestStreak).toBe(3)
  })

  it('时段与星期分布按本地时间对齐', async () => {
    const userId = await createUser()
    // UTC 周六 2026-03-14T20:00Z = 东八区 周日 3/15 04:00
    await logUsage(userId, { at: new Date('2026-03-14T20:00:00Z') })
    const stats = await usageStats.getMyUsageStats(userId, { tzOffsetMinutes: 480, days: 730 })
    expect(stats.busiestHour).toBe(4)
    expect(stats.busiestWeekday).toBe(0) // 0=周日
    expect(stats.byHour[4]).toBe(1)
  })

  it('统计会话数、消息数与生图次数', async () => {
    const userId = await createUser()
    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId, title: '测试' })
      .returning()
    await dbClient.db.insert(schema.messages).values([
      { conversationId: conversation!.id, role: 'user', content: [] },
      { conversationId: conversation!.id, role: 'assistant', content: [] },
    ])
    await logUsage(userId, { at: new Date(), imageTokens: 100 })

    const stats = await usageStats.getMyUsageStats(userId, { days: 30 })
    expect(stats.totals.conversations).toBe(1)
    expect(stats.totals.messages).toBe(2)
    expect(stats.totals.imageGenerations).toBe(1)
    expect(stats.firstUsedAt).not.toBeNull()
  })

  it('管理端复用的分模型明细按窗口过滤', async () => {
    const userId = await createUser()
    await logUsage(userId, { at: new Date(), modelLabel: 'recent' })
    await logUsage(userId, { at: new Date(Date.now() - 60 * DAY_MS), modelLabel: 'old' })

    const recent = await usageStats.getUserModelUsage(userId, 30)
    expect(recent.map((row) => row.modelLabel)).toEqual(['recent'])
    const all = await usageStats.getUserModelUsage(userId, 0)
    expect(all.map((row) => row.modelLabel).sort()).toEqual(['old', 'recent'])
  })
})
