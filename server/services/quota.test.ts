import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelPricing, QuotaRule, UsageLogKind } from '@shared/types/domain'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let quota: typeof import('./quota')
let appConfig: typeof import('./appConfig')
let fixtureSeq = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-quota-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-quota'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  quota = await import('./quota')
  appConfig = await import('./appConfig')
  migration.runMigrations()
})

beforeEach(async () => {
  dbClient.sqlite.exec('DELETE FROM app_settings')
  await appConfig.updateAppConfig({ quotaEnabled: true, quotaTimezone: 'Asia/Shanghai' })
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

const PRICING: ModelPricing = { input: 1_000_000, output: 1_000_000 }

const capabilities = {
  vision: false,
  file_input: false,
  web_search: false,
  x_search: false,
  image_generation: false,
  reasoning: false,
}

/** 用户 + 供应商 + 2 个模型（第二个属于一个分组）；每次调用序号递增，不做全表清理。 */
async function createFixture() {
  const n = fixtureSeq++
  const userId = `quota-user-${n}`
  const providerId = `quota-provider-${n}`
  const groupId = `quota-group-${n}`
  const modelA = `quota-model-a-${n}`
  const modelB = `quota-model-b-${n}`

  await dbClient.db
    .insert(schema.users)
    .values({ id: userId, username: `quota-user-${n}`, passwordHash: 'hash', role: 'user' })
  await dbClient.db.insert(schema.providers).values({
    id: providerId,
    name: `Provider ${n}`,
    baseUrl: 'https://example.test/v1',
    apiKey: 'key',
    protocol: 'openai',
  })
  await dbClient.db.insert(schema.modelGroups).values({ id: groupId, name: `Group ${n}` })
  await dbClient.db.insert(schema.models).values([
    {
      id: modelA,
      providerId,
      modelId: `upstream-a-${n}`,
      displayName: `Model A${n}`,
      capabilities,
      pricing: PRICING,
      sort: 100,
    },
    {
      id: modelB,
      providerId,
      modelId: `upstream-b-${n}`,
      displayName: `Model B${n}`,
      capabilities,
      pricing: PRICING,
      groupId,
      sort: 200,
    },
  ])
  return { userId, providerId, groupId, modelA, modelB }
}

/** 写一条用量日志：1 次请求 + 指定成本（价格快照为 $1/token 便于直算）。 */
async function logUsage(
  userId: string,
  modelId: string,
  options: {
    costUsd?: number
    success?: boolean
    createdAt?: Date
    quotaAt?: Date
    kind?: UsageLogKind
  } = {},
) {
  const tokens = Math.round((options.costUsd ?? 0) * 1)
  await dbClient.db.insert(schema.usageLogs).values({
    userId,
    modelId,
    kind: options.kind ?? 'chat',
    pricingSnapshot: PRICING,
    inputTokens: tokens,
    totalTokens: tokens,
    success: options.success ?? true,
    quotaAt: options.quotaAt,
    createdAt: options.createdAt ?? new Date(),
  })
}

/** 绑定一个只属于该用户的策略。 */
async function bindPolicy(userId: string, rules: QuotaRule[], isDefault = false) {
  const policyId = `policy-${userId}`
  await dbClient.db.insert(schema.quotaPolicies).values({
    id: policyId,
    name: `Policy ${userId}`,
    rules,
    isDefault,
  })
  await dbClient.db.insert(schema.userQuotas).values({ userId, policyId })
  return policyId
}

const monthlyCost = (value: number, id = 'r-cost'): QuotaRule => ({
  id,
  label: null,
  scope: { type: 'all' },
  metric: 'cost',
  limit: { kind: 'amount', value },
  window: { type: 'calendar', period: 'month' },
  priority: 0,
})

const dailyRequests = (value: number, id = 'r-req'): QuotaRule => ({
  id,
  label: null,
  scope: { type: 'all' },
  metric: 'requests',
  limit: { kind: 'amount', value },
  window: { type: 'calendar', period: 'day' },
  priority: 0,
})

const anchoredRequests = (value: number, hours: number, id = 'r-anchor'): QuotaRule => ({
  id,
  label: null,
  scope: { type: 'all' },
  metric: 'requests',
  limit: { kind: 'amount', value },
  window: { type: 'anchored', hours },
  priority: 0,
})

describe('额度快照与拦截', () => {
  it('未配置任何策略时无限额度、不拦截', async () => {
    const { userId, modelA } = await createFixture()
    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.unlimited).toBe(true)
    expect(snapshot.rules).toEqual([])
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(true)
  })

  it('全局关闭时完全不判定（配置与计数仍保留）', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [monthlyCost(1)])
    await logUsage(userId, modelA, { costUsd: 5 })

    await appConfig.updateAppConfig({ quotaEnabled: false })
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(true)
    const view = await quota.getMyQuota(userId)
    expect(view.enabled).toBe(false)
    expect(view.rules).toEqual([])

    // 重新打开后原有用量立刻生效——计数从未被清除。
    await appConfig.updateAppConfig({ quotaEnabled: true })
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)
  })

  it('多条规则任一触顶即拦截，文案说明限制与重置时间', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [monthlyCost(100), dailyRequests(2)])
    await logUsage(userId, modelA, { costUsd: 1 })
    await logUsage(userId, modelA, { costUsd: 1 })

    const result = await quota.checkQuota(userId, modelA)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.ruleId).toBe('r-req')
    expect(result.message).toContain('每天请求次数已用尽（2 次 / 2 次）')
    expect(result.message).toContain('重置')
  })

  it('覆盖全部模型的额度耗尽时明确报告没有其他模型可用', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [dailyRequests(1)])
    await logUsage(userId, modelA)

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.allModelsBlocked).toBe(true)
    expect((await quota.getMyQuota(userId)).allModelsBlocked).toBe(true)
  })

  it('失败请求既不计费也不计次', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [dailyRequests(2)])
    await logUsage(userId, modelA, { success: false })
    await logUsage(userId, modelA, { success: false })

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules[0]?.used).toBe(0)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(true)
  })

  it('标题日志保留在 usage_logs，但不计入请求次数或成本额度', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [dailyRequests(1), monthlyCost(1)])
    await logUsage(userId, modelA, { kind: 'title', costUsd: 5 })

    let snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules.map((rule) => rule.used)).toEqual([0, 0])
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(true)

    // 同模型、同价格的一条用户对话仍会同时消耗两种额度，证明只排除了 title 类型。
    await logUsage(userId, modelA, { kind: 'chat', costUsd: 1 })
    snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules.map((rule) => rule.used)).toEqual([1, 1])
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)
  })

  it('在途 run 计入请求次数，终态后不双算', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [dailyRequests(2)])
    const [conversation] = await dbClient.db
      .insert(schema.conversations)
      .values({ userId, modelId: modelA })
      .returning()
    await dbClient.db.insert(schema.runs).values([
      {
        id: `run-${userId}-1`,
        conversationId: conversation!.id,
        userId,
        modelId: modelA,
        state: 'running',
      },
      {
        id: `run-${userId}-2`,
        conversationId: conversation!.id,
        userId,
        modelId: modelA,
        state: 'queued',
      },
    ])

    expect((await quota.getQuotaSnapshot(userId)).rules[0]?.used).toBe(2)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)

    // finalize：run 进入终态并写入用量日志——总数仍是 2，不会变成 4。
    await dbClient.db
      .update(schema.runs)
      .set({ state: 'completed' })
      .where(eq(schema.runs.userId, userId))
    await logUsage(userId, modelA)
    await logUsage(userId, modelA)
    expect((await quota.getQuotaSnapshot(userId)).rules[0]?.used).toBe(2)
  })

  it('按模型独立额度：耗尽只影响该模型', async () => {
    const { userId, modelA, modelB } = await createFixture()
    await bindPolicy(userId, [
      {
        id: 'per-model',
        label: null,
        scope: { type: 'models', modelIds: [modelA, modelB], mode: 'each' },
        metric: 'requests',
        limit: { kind: 'amount', value: 1 },
        window: { type: 'calendar', period: 'day' },
        priority: 0,
      },
    ])
    await logUsage(userId, modelA)

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules).toHaveLength(2)
    expect(snapshot.blockedModelIds).toEqual([modelA])
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)
    expect((await quota.checkQuota(userId, modelB)).ok).toBe(true)
  })

  it('共享额度：任一模型的用量都消耗同一个池', async () => {
    const { userId, modelA, modelB } = await createFixture()
    await bindPolicy(userId, [
      {
        id: 'shared',
        label: null,
        scope: { type: 'models', modelIds: [modelA, modelB], mode: 'shared' },
        metric: 'requests',
        limit: { kind: 'amount', value: 2 },
        window: { type: 'calendar', period: 'day' },
        priority: 0,
      },
    ])
    await logUsage(userId, modelA)
    await logUsage(userId, modelB)

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules).toHaveLength(1)
    expect(snapshot.rules[0]?.used).toBe(2)
    expect(snapshot.blockedModelIds).toEqual(expect.arrayContaining([modelA, modelB]))
    // 这条显式模型规则不影响账号可见的其他模型，因此不是全局耗尽。
    expect(snapshot.allModelsBlocked).toBe(false)
    expect((await quota.getMyQuota(userId)).allModelsBlocked).toBe(false)
  })

  it('按分组设限只统计组内模型；分组被删除后规则失效且不拦截', async () => {
    const { userId, groupId, modelA, modelB } = await createFixture()
    await bindPolicy(userId, [
      {
        id: 'group-rule',
        label: null,
        scope: { type: 'groups', groupIds: [groupId], mode: 'each' },
        metric: 'requests',
        limit: { kind: 'amount', value: 1 },
        window: { type: 'calendar', period: 'day' },
        priority: 0,
      },
    ])
    await logUsage(userId, modelA) // 组外模型，不计入

    let snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules[0]?.used).toBe(0)

    await logUsage(userId, modelB) // 组内模型
    snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules[0]?.used).toBe(1)
    expect(snapshot.blockedModelIds).toEqual([modelB])

    await dbClient.db.delete(schema.modelGroups).where(eq(schema.modelGroups.id, groupId))
    snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules[0]?.invalid).toBe(true)
    expect(snapshot.rules[0]?.blocked).toBe(false)
    expect(snapshot.blockedModelIds).toEqual([])
  })

  it('成本额度按价格快照累计（改价不影响历史）', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [monthlyCost(3)])
    await logUsage(userId, modelA, { costUsd: 2 })

    let snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules[0]?.used).toBeCloseTo(2)
    expect(snapshot.rules[0]?.remaining).toBeCloseTo(1)

    await logUsage(userId, modelA, { costUsd: 1 })
    snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules[0]?.blocked).toBe(true)
  })

  it('用户覆写可提高上限，也可改成无限额度', async () => {
    const { userId, modelA } = await createFixture()
    const policyId = await bindPolicy(userId, [monthlyCost(10)])
    await logUsage(userId, modelA, { costUsd: 12 })
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)

    await dbClient.db
      .update(schema.userQuotas)
      .set({ overrides: { rules: { 'r-cost': { limit: { kind: 'amount', value: 30 } } } } })
      .where(eq(schema.userQuotas.userId, userId))
    const overridden = await quota.getQuotaSnapshot(userId)
    expect(overridden.rules[0]?.source).toBe('override')
    expect(overridden.rules[0]?.effectiveLimit).toBe(30)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(true)

    await dbClient.db
      .update(schema.userQuotas)
      .set({ overrides: { rules: { 'r-cost': { limit: { kind: 'unlimited' } } } } })
      .where(eq(schema.userQuotas.userId, userId))
    const unlimited = await quota.getQuotaSnapshot(userId)
    expect(unlimited.unlimited).toBe(true)
    expect(unlimited.rules[0]?.effectiveLimit).toBeNull()
    expect(policyId).toBeTruthy()
  })

  it('暂停限额：不拦截但用量继续累计，恢复后立即回到已耗尽', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [monthlyCost(10)])
    await logUsage(userId, modelA, { costUsd: 8 })

    await dbClient.db
      .update(schema.userQuotas)
      .set({ enforcementPaused: true, pausedAt: new Date() })
      .where(eq(schema.userQuotas.userId, userId))
    await logUsage(userId, modelA, { costUsd: 7 })

    const paused = await quota.getQuotaSnapshot(userId)
    expect(paused.rules[0]?.used).toBeCloseTo(15) // 计数照常
    expect(paused.rules[0]?.blocked).toBe(true) // 展示为已耗尽
    expect(paused.blockedModelIds).toEqual([]) // 但不拦截
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(true)

    await dbClient.db
      .update(schema.userQuotas)
      .set({ enforcementPaused: false, pausedAt: null })
      .where(eq(schema.userQuotas.userId, userId))
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)
  })
})

describe('周期调整（临时额度 / 手动重置）', () => {
  it('临时额度叠加在上限之上，过期后自动失效', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [monthlyCost(10)])
    await logUsage(userId, modelA, { costUsd: 12 })
    const periodStart = (await quota.getQuotaSnapshot(userId)).rules[0]!.periodStart

    await dbClient.db.insert(schema.quotaAdjustments).values({
      id: `grant-${userId}`,
      userId,
      kind: 'grant',
      ruleId: 'r-cost',
      bucketKey: null,
      metric: 'cost',
      amount: 5,
      effectiveFrom: new Date(),
      periodStart: new Date(periodStart),
      expiresAt: new Date(Date.now() + 3_600_000),
    })

    const granted = await quota.getQuotaSnapshot(userId)
    expect(granted.rules[0]?.granted).toBe(5)
    expect(granted.rules[0]?.effectiveLimit).toBe(15)
    expect(granted.rules[0]?.blocked).toBe(false)
    expect(granted.rules[0]?.grants).toHaveLength(1)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(true)

    // 过期的赠送不再计入
    await dbClient.db
      .update(schema.quotaAdjustments)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.quotaAdjustments.userId, userId))
    const expired = await quota.getQuotaSnapshot(userId)
    expect(expired.rules[0]?.granted).toBe(0)
    expect(expired.rules[0]?.blocked).toBe(true)
  })

  it('绑定到旧周期的赠送不会在新周期复活', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [monthlyCost(10)])
    await logUsage(userId, modelA, { costUsd: 12 })

    await dbClient.db.insert(schema.quotaAdjustments).values({
      id: `grant-stale-${userId}`,
      userId,
      kind: 'grant',
      ruleId: 'r-cost',
      metric: 'cost',
      amount: 50,
      effectiveFrom: new Date(0),
      periodStart: new Date(0), // 上个纪元的周期
      expiresAt: null,
    })

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules[0]?.granted).toBe(0)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)
  })

  it('手动重置把统计起点抬到重置时刻，历史用量不被删除', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [monthlyCost(10)])
    await logUsage(userId, modelA, { costUsd: 12, createdAt: new Date(Date.now() - 60_000) })
    const periodStart = (await quota.getQuotaSnapshot(userId)).rules[0]!.periodStart

    await dbClient.db.insert(schema.quotaAdjustments).values({
      id: `reset-${userId}`,
      userId,
      kind: 'reset',
      ruleId: 'r-cost',
      metric: 'cost',
      amount: null,
      effectiveFrom: new Date(),
      periodStart: new Date(periodStart),
    })

    const afterReset = await quota.getQuotaSnapshot(userId)
    expect(afterReset.rules[0]?.used).toBe(0)
    expect(afterReset.rules[0]?.blocked).toBe(false)
    // 审计数据仍在：用量日志没有被删
    const usageRows = dbClient.sqlite
      .prepare('select count(*) as count from usage_logs where user_id = ?')
      .all(userId) as { count: number }[]
    expect(usageRows[0]?.count).toBe(1)
  })

  it.each([
    ['月度', { type: 'calendar', period: 'month' }],
    ['永久累计', { type: 'total' }],
  ] as const)('日额度重置过期后，同 ID 规则改为%s不会沿用旧统计起点', async (_label, window) => {
    const { userId, modelA } = await createFixture()
    const policyId = await bindPolicy(userId, [dailyRequests(10)])
    const now = new Date('2026-08-15T04:00:00.000Z')
    const usageAt = new Date('2026-08-14T01:00:00.000Z')
    const resetAt = new Date('2026-08-14T04:00:00.000Z')
    await logUsage(userId, modelA, { createdAt: usageAt })
    const dailyPeriodStart = (await quota.getQuotaSnapshot(userId, { now: resetAt.getTime() }))
      .rules[0]!.periodStart

    await dbClient.db.insert(schema.quotaAdjustments).values({
      id: `expired-daily-reset-${userId}`,
      userId,
      kind: 'reset',
      ruleId: 'r-req',
      metric: 'requests',
      amount: null,
      effectiveFrom: resetAt,
      periodStart: new Date(dailyPeriodStart),
      expiresAt: new Date('2026-08-14T16:00:00.000Z'),
    })
    await dbClient.db
      .update(schema.quotaPolicies)
      .set({ rules: [{ ...dailyRequests(10), window }] })
      .where(eq(schema.quotaPolicies.id, policyId))

    const snapshot = await quota.getQuotaSnapshot(userId, { now: now.getTime() })
    expect(snapshot.rules[0]?.usageStart).toBe(snapshot.rules[0]?.periodStart)
    expect(snapshot.rules[0]?.used).toBe(1)
  })

  it('「各自独立」规则的赠送只作用于指定模型', async () => {
    const { userId, modelA, modelB } = await createFixture()
    await bindPolicy(userId, [
      {
        id: 'per-model',
        label: null,
        scope: { type: 'models', modelIds: [modelA, modelB], mode: 'each' },
        metric: 'requests',
        limit: { kind: 'amount', value: 1 },
        window: { type: 'calendar', period: 'day' },
        priority: 0,
      },
    ])
    await logUsage(userId, modelA)
    await logUsage(userId, modelB)
    const periodStart = (await quota.getQuotaSnapshot(userId)).rules[0]!.periodStart

    await dbClient.db.insert(schema.quotaAdjustments).values({
      id: `grant-bucket-${userId}`,
      userId,
      kind: 'grant',
      ruleId: 'per-model',
      bucketKey: modelA,
      metric: 'requests',
      amount: 3,
      effectiveFrom: new Date(),
      periodStart: new Date(periodStart),
      expiresAt: new Date(Date.now() + 3_600_000),
    })

    const snapshot = await quota.getQuotaSnapshot(userId)
    const byBucket = new Map(snapshot.rules.map((rule) => [rule.bucketKey, rule]))
    expect(byBucket.get(modelA)?.effectiveLimit).toBe(4)
    expect(byBucket.get(modelB)?.effectiveLimit).toBe(1)
    expect(snapshot.blockedModelIds).toEqual([modelB])
  })
})

describe('滚动窗口的周期调整', () => {
  const rollingRequests = (value: number, hours: number, id = 'r-roll'): QuotaRule => ({
    id,
    label: null,
    scope: { type: 'all' },
    metric: 'requests',
    limit: { kind: 'amount', value },
    window: { type: 'rolling', hours },
    priority: 0,
  })

  /** 回归：滚动窗口的 periodStart 每毫秒前移，一旦按「相等」匹配，赠送写完就失效。 */
  it('赠送在滚动窗口内持续有效（不因窗口起点前移而失效）', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [rollingRequests(1, 5)])
    await logUsage(userId, modelA)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)

    const now = Date.now()
    await dbClient.db.insert(schema.quotaAdjustments).values({
      id: `grant-roll-${userId}`,
      userId,
      kind: 'grant',
      ruleId: 'r-roll',
      metric: 'requests',
      amount: 3,
      effectiveFrom: new Date(now),
      // 服务写入的就是「此刻 - 窗口长度」，下一次查询时这个值已经不再等于新的窗口起点。
      periodStart: new Date(now - 5 * 3_600_000),
      expiresAt: new Date(now + 5 * 3_600_000),
    })

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules[0]?.granted).toBe(3)
    expect(snapshot.rules[0]?.effectiveLimit).toBe(4)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(true)
  })

  it('手动重置在滚动窗口内持续有效，滑出窗口后自然失效', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [rollingRequests(1, 5)])
    await logUsage(userId, modelA, { createdAt: new Date(Date.now() - 60_000) })

    const now = Date.now()
    await dbClient.db.insert(schema.quotaAdjustments).values({
      id: `reset-roll-${userId}`,
      userId,
      kind: 'reset',
      ruleId: 'r-roll',
      metric: 'requests',
      amount: null,
      effectiveFrom: new Date(now),
      periodStart: new Date(now - 5 * 3_600_000),
    })
    expect((await quota.getQuotaSnapshot(userId)).rules[0]?.used).toBe(0)

    // 重置时刻滑出窗口后不再生效（此时窗口内也已经没有那条用量了）。
    await dbClient.db
      .update(schema.quotaAdjustments)
      .set({ effectiveFrom: new Date(now - 6 * 3_600_000) })
      .where(eq(schema.quotaAdjustments.userId, userId))
    const later = await quota.getQuotaSnapshot(userId)
    expect(later.rules[0]?.usageStart).toBe(later.rules[0]?.periodStart)
  })

  it('「重置全部」（bucketKey 为空）覆盖各自独立展开出的每个桶', async () => {
    const { userId, modelA, modelB } = await createFixture()
    await bindPolicy(userId, [
      {
        id: 'per-model',
        label: null,
        scope: { type: 'models', modelIds: [modelA, modelB], mode: 'each' },
        metric: 'requests',
        limit: { kind: 'amount', value: 1 },
        window: { type: 'calendar', period: 'day' },
        priority: 0,
      },
    ])
    await logUsage(userId, modelA, { createdAt: new Date(Date.now() - 60_000) })
    await logUsage(userId, modelB, { createdAt: new Date(Date.now() - 60_000) })
    const periodStart = (await quota.getQuotaSnapshot(userId)).rules[0]!.periodStart

    await dbClient.db.insert(schema.quotaAdjustments).values({
      id: `reset-all-${userId}`,
      userId,
      kind: 'reset',
      ruleId: 'per-model',
      bucketKey: null,
      metric: 'requests',
      amount: null,
      effectiveFrom: new Date(),
      periodStart: new Date(periodStart),
    })

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules.map((rule) => rule.used)).toEqual([0, 0])
    expect(snapshot.blockedModelIds).toEqual([])
  })
})

describe('首次请求起算的固定周期', () => {
  it('未请求时不计时；同周期请求复用首个锚点', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [anchoredRequests(2, 5)])
    const requestAt = new Date('2026-08-15T01:00:00.000Z')

    const before = await quota.getQuotaSnapshot(userId, { now: requestAt.getTime() })
    expect(before.rules[0]).toMatchObject({
      periodActive: false,
      periodStart: 0,
      periodEnd: null,
      used: 0,
      blocked: false,
    })

    const admission = await quota.prepareQuotaAdmission(userId, modelA)
    expect(admission.check).toEqual({ ok: true })
    expect(admission.cycleClaims).toEqual([{ ruleId: 'r-anchor', bucketKey: null, windowHours: 5 }])
    quota.activateQuotaCycles(userId, admission.cycleClaims, requestAt)
    quota.activateQuotaCycles(
      userId,
      admission.cycleClaims,
      new Date(requestAt.getTime() + 2 * 3_600_000),
    )

    const active = await quota.getQuotaSnapshot(userId, {
      now: requestAt.getTime() + 2 * 3_600_000,
    })
    expect(active.rules[0]).toMatchObject({
      periodActive: true,
      periodStart: requestAt.getTime(),
      periodEnd: requestAt.getTime() + 5 * 3_600_000,
    })
  })

  it('到期后由下一请求开启新周期，跨边界完成的旧请求不串入新周期', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [anchoredRequests(1, 5)])
    const firstStart = new Date('2026-08-15T01:00:00.000Z')
    const admission = await quota.prepareQuotaAdmission(userId, modelA)
    quota.activateQuotaCycles(userId, admission.cycleClaims, firstStart)

    const nextStart = new Date(firstStart.getTime() + 6 * 3_600_000)
    quota.activateQuotaCycles(userId, admission.cycleClaims, nextStart)
    const completedAt = new Date(nextStart.getTime() + 60_000)
    // 旧请求在新周期开始后才完成：created_at 属于新周期，但 quota_at 仍属于旧周期。
    await logUsage(userId, modelA, {
      createdAt: completedAt,
      quotaAt: new Date(firstStart.getTime() + 60_000),
    })
    await logUsage(userId, modelA, {
      createdAt: completedAt,
      quotaAt: new Date(nextStart.getTime() + 30_000),
    })

    const snapshot = await quota.getQuotaSnapshot(userId, {
      now: nextStart.getTime() + 2 * 60_000,
    })
    expect(snapshot.rules[0]).toMatchObject({
      periodActive: true,
      periodStart: nextStart.getTime(),
      used: 1,
      blocked: true,
    })
  })
})

describe('规则优先级遮蔽', () => {
  /** 两个模型同属一个分组：分组整体限额，其中一个模型用更高优先级豁免。 */
  async function groupFixture() {
    const fixture = await createFixture()
    await dbClient.db
      .update(schema.models)
      .set({ groupId: fixture.groupId })
      .where(eq(schema.models.id, fixture.modelA))
    return fixture
  }

  const groupRequests = (groupId: string, value: number): QuotaRule => ({
    id: 'r-group',
    label: null,
    scope: { type: 'groups', groupIds: [groupId], mode: 'shared' },
    metric: 'requests',
    limit: { kind: 'amount', value },
    window: { type: 'calendar', period: 'day' },
    priority: 0,
  })

  const exempt = (modelId: string, priority: number): QuotaRule => ({
    id: 'r-exempt',
    label: null,
    scope: { type: 'models', modelIds: [modelId], mode: 'each' },
    metric: 'requests',
    limit: { kind: 'unlimited' },
    window: { type: 'calendar', period: 'day' },
    priority,
  })

  it('高优先级豁免让该模型不受分组规则约束，用量也不计入分组桶', async () => {
    const { userId, groupId, modelA, modelB } = await groupFixture()
    await bindPolicy(userId, [groupRequests(groupId, 2), exempt(modelB, 10)])
    await logUsage(userId, modelA)
    await logUsage(userId, modelB)
    await logUsage(userId, modelB)
    await logUsage(userId, modelB)

    const snapshot = await quota.getQuotaSnapshot(userId)
    const groupBucket = snapshot.rules.find((rule) => rule.ruleId === 'r-group')
    // 分组桶只统计未被接管的 modelA
    expect(groupBucket?.used).toBe(1)
    expect(groupBucket?.blocked).toBe(false)
    expect(snapshot.blockedModelIds).toEqual([])
    expect((await quota.checkQuota(userId, modelB)).ok).toBe(true)

    // 组内其他模型照常受限，新模型进组无需任何额外配置
    await logUsage(userId, modelA)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)
    expect((await quota.checkQuota(userId, modelB)).ok).toBe(true)
  })

  it('同一优先级档内不发生遮蔽（0 档豁免等于没写这条规则）', async () => {
    const { userId, groupId, modelA, modelB } = await groupFixture()
    await bindPolicy(userId, [groupRequests(groupId, 1), exempt(modelB, 0)])
    await logUsage(userId, modelB)

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules.find((rule) => rule.ruleId === 'r-group')?.used).toBe(1)
    expect((await quota.checkQuota(userId, modelB)).ok).toBe(false)
    expect(modelA).toBeTruthy()
  })

  it('被完全接管的桶标记 shadowed 且永不拦截', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [
      {
        id: 'r-low',
        label: null,
        scope: { type: 'models', modelIds: [modelA], mode: 'each' },
        metric: 'requests',
        limit: { kind: 'amount', value: 1 },
        window: { type: 'calendar', period: 'day' },
        priority: 0,
      },
      exempt(modelA, 5),
    ])
    await logUsage(userId, modelA)
    await logUsage(userId, modelA)

    const snapshot = await quota.getQuotaSnapshot(userId)
    const low = snapshot.rules.find((rule) => rule.ruleId === 'r-low')
    expect(low?.shadowed).toBe(true)
    expect(low?.used).toBe(0)
    expect(low?.blocked).toBe(false)
    expect(snapshot.blockedModelIds).toEqual([])
    expect(snapshot.unlimited).toBe(true)
    const myQuota = await quota.getMyQuota(userId)
    expect(myQuota).toMatchObject({
      unlimited: true,
      allModelsBlocked: false,
    })
    expect(myQuota.rules.map((rule) => rule.ruleId)).toEqual(['r-exempt'])
  })

  it('「全部模型」规则部分被遮蔽后只限制其余模型，并准确报告仍有模型可用', async () => {
    const { userId, modelA, modelB } = await createFixture()
    await bindPolicy(userId, [dailyRequests(1), exempt(modelB, 3)])
    await logUsage(userId, modelA)
    await logUsage(userId, modelB)
    await logUsage(userId, modelB)

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules.find((rule) => rule.ruleId === 'r-req')?.used).toBe(1)
    expect(snapshot.unlimited).toBe(false)
    expect(snapshot.blockedModelIds).toContain(modelA)
    expect(snapshot.blockedModelIds).not.toContain(modelB)
    expect(snapshot.allModelsBlocked).toBe(false)
    const myQuota = await quota.getMyQuota(userId)
    expect(myQuota.allModelsBlocked).toBe(false)
    const effectiveModelIds = myQuota.rules.find(
      (rule) => rule.ruleId === 'r-req',
    )?.effectiveModelIds
    expect(effectiveModelIds).toContain(modelA)
    expect(effectiveModelIds).not.toContain(modelB)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)
    expect((await quota.checkQuota(userId, modelB)).ok).toBe(true)
  })
})

describe('默认策略', () => {
  it('没有 user_quotas 行的用户跟随默认策略', async () => {
    const { userId, modelA } = await createFixture()
    await dbClient.db.insert(schema.quotaPolicies).values({
      id: `default-policy-${userId}`,
      name: '默认用户',
      rules: [dailyRequests(1)],
      isDefault: true,
    })
    await logUsage(userId, modelA)

    const binding = await quota.getUserQuotaBinding(userId)
    expect(binding.usingDefaultPolicy).toBe(true)
    expect(binding.policyName).toBe('默认用户')
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(false)

    await dbClient.db
      .delete(schema.quotaPolicies)
      .where(eq(schema.quotaPolicies.id, `default-policy-${userId}`))
  })
})
