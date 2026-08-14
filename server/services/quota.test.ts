import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelPricing, QuotaRule } from '@shared/types/domain'

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
  options: { costUsd?: number; success?: boolean; createdAt?: Date } = {},
) {
  const tokens = Math.round((options.costUsd ?? 0) * 1)
  await dbClient.db.insert(schema.usageLogs).values({
    userId,
    modelId,
    pricingSnapshot: PRICING,
    inputTokens: tokens,
    totalTokens: tokens,
    success: options.success ?? true,
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
})

const dailyRequests = (value: number, id = 'r-req'): QuotaRule => ({
  id,
  label: null,
  scope: { type: 'all' },
  metric: 'requests',
  limit: { kind: 'amount', value },
  window: { type: 'calendar', period: 'day' },
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

  it('失败请求既不计费也不计次', async () => {
    const { userId, modelA } = await createFixture()
    await bindPolicy(userId, [dailyRequests(2)])
    await logUsage(userId, modelA, { success: false })
    await logUsage(userId, modelA, { success: false })

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules[0]?.used).toBe(0)
    expect((await quota.checkQuota(userId, modelA)).ok).toBe(true)
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
      },
    ])
    await logUsage(userId, modelA)
    await logUsage(userId, modelB)

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules).toHaveLength(1)
    expect(snapshot.rules[0]?.used).toBe(2)
    expect(snapshot.blockedModelIds).toEqual(expect.arrayContaining([modelA, modelB]))
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
