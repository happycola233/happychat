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
    // 活跃天数按窗口统计，连续天数按近一年的热力图序列滚动计算，因此这里数热力图。
    expect(stats.heatmap.filter((cell) => cell.requests > 0)).toHaveLength(4)
    expect(stats.totals.currentStreak).toBe(3)
    expect(stats.totals.longestStreak).toBe(3)
  })

  it('时段与星期分布按本地时间对齐', async () => {
    const userId = await createUser()
    // 取「东八区今天 04:00」对应的真实时刻：按相对时间构造，测试不会随年份失效。
    const offsetMs = 480 * 60_000
    const localDayStart = Math.floor((Date.now() + offsetMs) / DAY_MS) * DAY_MS
    const localFourAm = localDayStart + 4 * 3_600_000
    await logUsage(userId, { at: new Date(localFourAm - offsetMs) })

    const stats = await usageStats.getMyUsageStats(userId, {
      tzOffsetMinutes: 480,
      view: 'day',
    })
    expect(stats.busiestHour).toBe(4)
    expect(stats.busiestWeekday).toBe(new Date(localDayStart).getUTCDay())
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

  it('窗口视图按自然周期切片：昨天的用量不计入「今日」', async () => {
    const userId = await createUser()
    const offsetMs = 480 * 60_000
    const localDayStart = Math.floor((Date.now() + offsetMs) / DAY_MS) * DAY_MS
    // 今天本地 10:00 与昨天本地 10:00
    await logUsage(userId, { at: new Date(localDayStart + 10 * 3_600_000 - offsetMs), tokens: 5 })
    await logUsage(userId, {
      at: new Date(localDayStart - DAY_MS + 10 * 3_600_000 - offsetMs),
      tokens: 7,
    })

    const today = await usageStats.getMyUsageStats(userId, { tzOffsetMinutes: 480, view: 'day' })
    expect(today.totals.requests).toBe(1)
    expect(today.totals.totalTokens).toBe(5)
    expect(today.granularity).toBe('hour')
    expect(today.windowStart).toBe(localDayStart - offsetMs)
    expect(today.windowEnd).toBe(localDayStart + DAY_MS - offsetMs)
    // 热力图与窗口解耦：仍能看到昨天那一格
    expect(today.heatmap.filter((cell) => cell.requests > 0)).toHaveLength(2)

    const year = await usageStats.getMyUsageStats(userId, { tzOffsetMinutes: 480, view: 'year' })
    expect(year.totals.requests).toBe(2)
    expect(year.granularity).toBe('month')
  })

  it('IANA 时区的 DST 开始日使用 23 小时窗口并跳过不存在的小时', async () => {
    const userId = await createUser()
    const now = Date.parse('2026-03-09T03:30:00Z') // 纽约 3/8 23:30
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      await logUsage(userId, { at: new Date('2026-03-08T04:59:59Z'), tokens: 9 })
      await logUsage(userId, { at: new Date('2026-03-08T06:30:00Z'), tokens: 1 }) // 01:30
      await logUsage(userId, { at: new Date('2026-03-08T07:30:00Z'), tokens: 2 }) // 03:30

      const stats = await usageStats.getMyUsageStats(userId, {
        timezone: 'America/New_York',
        view: 'day',
      })
      expect(new Date(stats.windowStart).toISOString()).toBe('2026-03-08T05:00:00.000Z')
      expect(new Date(stats.windowEnd).toISOString()).toBe('2026-03-09T04:00:00.000Z')
      expect(stats.windowEnd - stats.windowStart).toBe(23 * 3_600_000)
      expect(stats.totals.requests).toBe(2)
      expect(stats.byHour[1]).toBe(1)
      expect(stats.byHour[2]).toBe(0)
      expect(stats.byHour[3]).toBe(1)
      expect(stats.trend).toHaveLength(23)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('IANA 时区的 DST 结束日保留两个真实的重复小时桶', async () => {
    const userId = await createUser()
    const now = Date.parse('2026-11-02T04:30:00Z') // 纽约 11/1 23:30
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      await logUsage(userId, { at: new Date('2026-11-01T05:30:00Z') }) // 01:30 EDT
      await logUsage(userId, { at: new Date('2026-11-01T06:30:00Z') }) // 01:30 EST

      const stats = await usageStats.getMyUsageStats(userId, {
        timezone: 'America/New_York',
        view: 'day',
      })
      expect(stats.windowEnd - stats.windowStart).toBe(25 * 3_600_000)
      expect(stats.totals.requests).toBe(2)
      expect(stats.byHour[1]).toBe(2)
      expect(stats.trend).toHaveLength(25)
      expect(stats.trend.filter((point) => point.requests > 0).map((point) => point.ts)).toEqual([
        Date.parse('2026-11-01T05:00:00Z'),
        Date.parse('2026-11-01T06:00:00Z'),
      ])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('本周起点跟随站点配置（周一 / 周日）', async () => {
    const userId = await createUser()
    const monday = await usageStats.getMyUsageStats(userId, {
      tzOffsetMinutes: 0,
      view: 'week',
      weekStart: 'mon',
    })
    const sunday = await usageStats.getMyUsageStats(userId, {
      tzOffsetMinutes: 0,
      view: 'week',
      weekStart: 'sun',
    })
    expect(new Date(monday.windowStart).getUTCDay()).toBe(1)
    expect(new Date(sunday.windowStart).getUTCDay()).toBe(0)
    expect(monday.windowEnd - monday.windowStart).toBe(7 * DAY_MS)
  })

  it('趋势按粒度补齐空桶，且只覆盖已经发生的时段', async () => {
    const userId = await createUser()
    const offsetMs = 0
    const localDayStart = Math.floor(Date.now() / DAY_MS) * DAY_MS
    await logUsage(userId, { at: new Date(localDayStart + 3_600_000), tokens: 2 })

    const stats = await usageStats.getMyUsageStats(userId, { tzOffsetMinutes: 0, view: 'day' })
    const currentHour = new Date(Date.now() + offsetMs).getUTCHours()
    expect(stats.trend).toHaveLength(currentHour + 1)
    expect(stats.trend[0]?.ts).toBe(localDayStart)
    expect(stats.trend[1]?.requests).toBe(1)
  })

  it('对话与消息数按窗口统计（不再是终身累计）', async () => {
    const userId = await createUser()
    const [old] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId, title: '很久以前', createdAt: new Date(Date.now() - 400 * DAY_MS) })
      .returning()
    await dbClient.db.insert(schema.messages).values({
      conversationId: old!.id,
      role: 'user',
      content: [],
      createdAt: new Date(Date.now() - 400 * DAY_MS),
    })
    const [fresh] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId, title: '刚刚' })
      .returning()
    await dbClient.db
      .insert(schema.messages)
      .values({ conversationId: fresh!.id, role: 'user', content: [] })

    const today = await usageStats.getMyUsageStats(userId, { tzOffsetMinutes: 0, view: 'day' })
    expect(today.totals.conversations).toBe(1)
    expect(today.totals.messages).toBe(1)
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
