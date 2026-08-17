import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelPricing, QuotaRule } from '@shared/types/domain'

let tmpDir: string
let dbClient: typeof import('../db/client')
let schema: typeof import('../db/schema')
let admin: typeof import('./quota-admin')
let quota: typeof import('./quota')
let appConfig: typeof import('./appConfig')
let fixtureSeq = 0

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'happychat-quota-admin-'))
  process.env.NODE_ENV = 'test'
  process.env.DATA_DIR = tmpDir
  process.env.DATABASE_URL = join(tmpDir, 'happychat-test.db')
  process.env.SESSION_SECRET = 'test-session-secret-quota-admin'

  vi.resetModules()
  const migration = await import('../db/migrate')
  dbClient = await import('../db/client')
  schema = await import('../db/schema')
  admin = await import('./quota-admin')
  quota = await import('./quota')
  appConfig = await import('./appConfig')
  migration.runMigrations()
})

beforeEach(async () => {
  dbClient.sqlite.exec('DELETE FROM quota_adjustments')
  dbClient.sqlite.exec('DELETE FROM user_quotas')
  dbClient.sqlite.exec('DELETE FROM quota_policies')
  dbClient.sqlite.exec('DELETE FROM app_settings')
  await appConfig.updateAppConfig({ quotaEnabled: true, quotaTimezone: 'Asia/Shanghai' })
})

afterAll(() => {
  dbClient?.sqlite.close()
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

const PRICING: ModelPricing = { input: 1_000_000 }

const monthlyCost = (value: number, id = 'r-cost'): QuotaRule => ({
  id,
  label: null,
  scope: { type: 'all' },
  metric: 'cost',
  limit: { kind: 'amount', value },
  window: { type: 'calendar', period: 'month' },
  priority: 0,
})

const perModelRequests = (modelIds: string[], value: number, id = 'r-each'): QuotaRule => ({
  id,
  label: null,
  scope: { type: 'models', modelIds, mode: 'each' },
  metric: 'requests',
  limit: { kind: 'amount', value },
  window: { type: 'calendar', period: 'day' },
  priority: 0,
})

async function createUser(role: 'admin' | 'user' = 'user', lastLoginAt?: number) {
  const n = fixtureSeq++
  const id = `qa-user-${n}`
  await dbClient.db.insert(schema.users).values({
    id,
    username: `qa-user-${n}`,
    passwordHash: 'hash',
    role,
    lastLoginAt: lastLoginAt === undefined ? null : new Date(lastLoginAt),
  })
  return id
}

async function createModel() {
  const n = fixtureSeq++
  const providerId = `qa-provider-${n}`
  const modelId = `qa-model-${n}`
  await dbClient.db.insert(schema.providers).values({
    id: providerId,
    name: `Provider ${n}`,
    baseUrl: 'https://example.test/v1',
    apiKey: 'key',
    protocol: 'openai',
  })
  await dbClient.db.insert(schema.models).values({
    id: modelId,
    providerId,
    modelId: `upstream-${n}`,
    displayName: `Model ${n}`,
    pricing: PRICING,
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
    },
  })
  return modelId
}

async function logUsage(
  userId: string,
  modelId: string,
  costUsd = 0,
  options: { createdAt?: number; success?: boolean } = {},
) {
  await dbClient.db.insert(schema.usageLogs).values({
    userId,
    modelId,
    pricingSnapshot: PRICING,
    inputTokens: costUsd,
    totalTokens: costUsd,
    success: options.success ?? true,
    createdAt: options.createdAt === undefined ? undefined : new Date(options.createdAt),
  })
}

describe('策略管理', () => {
  it('创建 / 更新 / 设为默认，至多一条默认策略', async () => {
    const first = await admin.createQuotaPolicy({
      name: '默认用户',
      rules: [monthlyCost(10)],
      isDefault: true,
    })
    expect(first.isDefault).toBe(true)

    const second = await admin.createQuotaPolicy({
      name: 'VIP',
      rules: [monthlyCost(100)],
      isDefault: true,
    })
    const policies = await admin.listQuotaPolicies()
    expect(policies.filter((policy) => policy.isDefault).map((policy) => policy.id)).toEqual([
      second.id,
    ])

    const updated = await admin.updateQuotaPolicy(first.id, { name: '默认用户（新）' })
    expect(updated.ok && updated.policy.name).toBe('默认用户（新）')
    expect((await admin.updateQuotaPolicy('missing', { name: 'x' })).ok).toBe(false)
    // sort 使用稀疏步长，后建的策略排在后面
    expect(policies.map((policy) => policy.sort)).toEqual([100, 200])
  })

  it('零规则策略即「无限额度」，可正常创建与绑定', async () => {
    const policy = await admin.createQuotaPolicy({ name: '朋友', rules: [] })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.unlimited).toBe(true)
    expect(snapshot.rules).toEqual([])
  })

  it('复制策略时重新生成规则 id，避免与原策略共用覆写绑定键', async () => {
    const source = await admin.createQuotaPolicy({
      name: '测试账号',
      isDefault: false,
      rules: [monthlyCost(2), monthlyCost(5, 'r-second')],
    })
    const copy = await admin.duplicateQuotaPolicy(source.id)
    expect(copy.ok).toBe(true)
    if (!copy.ok) return
    expect(copy.policy.name).toBe('测试账号 副本')
    expect(copy.policy.rules).toHaveLength(2)
    expect(copy.policy.rules.map((rule) => rule.id)).not.toEqual(
      source.rules.map((rule) => rule.id),
    )
    expect(copy.policy.rules[0]?.limit).toEqual({ kind: 'amount', value: 2 })
  })

  it('删除策略：绑定用户回退默认策略且保留原 updatedAt', async () => {
    const fallback = await admin.createQuotaPolicy({
      name: '默认',
      rules: [monthlyCost(1)],
      isDefault: true,
    })
    const doomed = await admin.createQuotaPolicy({ name: '将被删除', rules: [monthlyCost(50)] })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: doomed.id, overrides: {}, enforcementPaused: false },
      userId,
    )

    const [before] = await dbClient.db
      .select()
      .from(schema.userQuotas)
      .where(eq(schema.userQuotas.userId, userId))
    const result = await admin.deleteQuotaPolicy(doomed.id)
    expect(result).toEqual({ ok: true, releasedUsers: 1 })

    const [after] = await dbClient.db
      .select()
      .from(schema.userQuotas)
      .where(eq(schema.userQuotas.userId, userId))
    expect(after?.policyId).toBeNull()
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())

    const binding = await quota.getUserQuotaBinding(userId)
    expect(binding.usingDefaultPolicy).toBe(true)
    expect(binding.policyName).toBe('默认')
    expect(fallback.isDefault).toBe(true)
  })

  it('还有其他策略时不允许删除默认策略', async () => {
    const def = await admin.createQuotaPolicy({ name: '默认', rules: [], isDefault: true })
    await admin.createQuotaPolicy({ name: '其他', rules: [] })
    expect(await admin.deleteQuotaPolicy(def.id)).toEqual({
      ok: false,
      code: 'last_default_policy',
    })
  })

  it('排序要求提交穷尽列表', async () => {
    const a = await admin.createQuotaPolicy({ name: 'A', rules: [] })
    const b = await admin.createQuotaPolicy({ name: 'B', rules: [] })
    expect(await admin.reorderQuotaPolicies([a.id])).toMatchObject({ ok: false })
    expect(await admin.reorderQuotaPolicies([b.id, a.id])).toEqual({ ok: true })
    const policies = await admin.listQuotaPolicies()
    expect(policies.map((policy) => policy.id)).toEqual([b.id, a.id])
  })

  it('绑定人数把「跟随默认策略」的用户计入默认策略', async () => {
    const def = await admin.createQuotaPolicy({ name: '默认', rules: [], isDefault: true })
    const vip = await admin.createQuotaPolicy({ name: 'VIP', rules: [monthlyCost(100)] })
    const following = await createUser()
    const explicit = await createUser()
    await admin.updateUserQuota(
      explicit,
      { policyId: vip.id, overrides: {}, enforcementPaused: false },
      explicit,
    )

    const policies = await admin.listQuotaPolicies()
    const byId = new Map(policies.map((policy) => [policy.id, policy]))
    expect(byId.get(vip.id)?.boundUserCount).toBe(1)
    // 未显式绑定的用户实际受默认策略约束，必须计入
    expect(byId.get(def.id)?.boundUserCount).toBeGreaterThanOrEqual(1)
    expect(following).toBeTruthy()
  })
})

describe('用户配置与批量指派', () => {
  it('批量指派只改策略绑定，保留覆写与暂停状态', async () => {
    const policy = await admin.createQuotaPolicy({ name: 'A', rules: [monthlyCost(10)] })
    const target = await admin.createQuotaPolicy({ name: 'B', rules: [monthlyCost(20)] })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      {
        policyId: policy.id,
        overrides: { rules: { 'r-cost': { limit: { kind: 'amount', value: 30 } } } },
        enforcementPaused: true,
      },
      userId,
    )

    const result = await admin.batchAssignQuotaPolicy([userId], target.id)
    expect(result).toEqual({ ok: true, updated: 1 })
    const binding = await quota.getUserQuotaBinding(userId)
    expect(binding.policyId).toBe(target.id)
    expect(binding.enforcementPaused).toBe(true)
    expect(binding.rules[0]?.source).toBe('override')
    expect(binding.rules[0]?.limit).toEqual({ kind: 'amount', value: 30 })
  })

  it('任一用户不存在时整批失败', async () => {
    const policy = await admin.createQuotaPolicy({ name: 'A', rules: [] })
    const userId = await createUser()
    const result = await admin.batchAssignQuotaPolicy([userId, 'ghost'], policy.id)
    expect(result).toMatchObject({ ok: false, code: 'unknown_users', invalidIds: ['ghost'] })
    expect((await quota.getUserQuotaBinding(userId)).policyId).toBeNull()
  })

  it('暂停时间只在首次暂停时刷新', async () => {
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: null, overrides: {}, enforcementPaused: true },
      userId,
    )
    const first = (await quota.getUserQuotaBinding(userId)).pausedAt
    expect(first).not.toBeNull()

    await admin.updateUserQuota(
      userId,
      { policyId: null, overrides: {}, enforcementPaused: true, note: '再次保存' },
      userId,
    )
    expect((await quota.getUserQuotaBinding(userId)).pausedAt).toBe(first)

    await admin.updateUserQuota(
      userId,
      { policyId: null, overrides: {}, enforcementPaused: false },
      userId,
    )
    expect((await quota.getUserQuotaBinding(userId)).pausedAt).toBeNull()
  })

  it('未知策略被拒绝', async () => {
    const userId = await createUser()
    expect(
      await admin.updateUserQuota(
        userId,
        { policyId: 'ghost', overrides: {}, enforcementPaused: false },
        userId,
      ),
    ).toEqual({ ok: false, code: 'policy_missing' })
  })
})

describe('临时额度与重置', () => {
  it('赠送额度绑定当前周期并给出到期时间', async () => {
    const policy = await admin.createQuotaPolicy({ name: 'A', rules: [monthlyCost(10)] })
    const userId = await createUser()
    const modelId = await createModel()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )
    await logUsage(userId, modelId, 12)
    expect((await quota.checkQuota(userId, modelId)).ok).toBe(false)

    const grant = await admin.createQuotaGrant(userId, { ruleId: 'r-cost', amount: 5 }, userId)
    expect(grant.ok).toBe(true)
    if (!grant.ok) return
    expect(grant.grant.metric).toBe('cost')
    expect(grant.grant.expiresAt).not.toBeNull()
    expect((await quota.checkQuota(userId, modelId)).ok).toBe(true)

    // 撤销后立即回到耗尽状态
    expect(await admin.revokeQuotaAdjustment(grant.grant.id)).toBe(true)
    expect((await quota.checkQuota(userId, modelId)).ok).toBe(false)
  })

  it('「各自独立」规则必须指定具体目标，无限额度规则拒绝赠送', async () => {
    const modelId = await createModel()
    const policy = await admin.createQuotaPolicy({
      name: 'A',
      isDefault: false,
      rules: [
        perModelRequests([modelId], 1),
        { ...monthlyCost(1, 'r-unlimited'), limit: { kind: 'unlimited' } },
      ],
    })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )

    expect(await admin.createQuotaGrant(userId, { ruleId: 'r-each', amount: 3 }, userId)).toEqual({
      ok: false,
      code: 'bucket_required',
    })
    expect(
      await admin.createQuotaGrant(
        userId,
        { ruleId: 'r-each', bucketKey: modelId, amount: 3 },
        userId,
      ),
    ).toMatchObject({ ok: true })
    expect(
      await admin.createQuotaGrant(userId, { ruleId: 'r-unlimited', amount: 3 }, userId),
    ).toEqual({ ok: false, code: 'unlimited_rule' })
    expect(await admin.createQuotaGrant(userId, { ruleId: 'ghost', amount: 3 }, userId)).toEqual({
      ok: false,
      code: 'rule_missing',
    })
  })

  it('重置全部周期为每条规则各写一条记录，用量日志保持不变', async () => {
    const policy = await admin.createQuotaPolicy({
      name: 'A',
      isDefault: false,
      rules: [
        monthlyCost(10),
        { ...monthlyCost(3, 'r-daily'), window: { type: 'calendar', period: 'day' } },
      ],
    })
    const userId = await createUser()
    const modelId = await createModel()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )
    await logUsage(userId, modelId, 12)

    const result = await admin.resetQuotaPeriod(userId, {}, userId)
    expect(result).toEqual({ ok: true, resetRules: 2 })

    const snapshot = await quota.getQuotaSnapshot(userId)
    expect(snapshot.rules.every((rule) => rule.used === 0)).toBe(true)
    const detail = await admin.getAdminUserQuotaDetail(userId)
    expect(detail).toMatchObject({
      quotaTimezone: 'Asia/Shanghai',
      warnThreshold: 0.8,
    })
    expect(detail?.adjustments.filter((row) => row.kind === 'reset')).toHaveLength(2)
    expect(detail?.adjustments.every((row) => row.active)).toBe(true)
  })

  it('拒绝指向不存在桶的调整与非整数的次数赠送', async () => {
    const modelId = await createModel()
    const policy = await admin.createQuotaPolicy({
      name: 'A',
      isDefault: false,
      rules: [perModelRequests([modelId], 5)],
    })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )

    // 不在规则范围内的 bucketKey 只会写出一条永不生效的记录，直接拒绝
    expect(
      await admin.createQuotaGrant(
        userId,
        { ruleId: 'r-each', bucketKey: 'ghost-model', amount: 3 },
        userId,
      ),
    ).toEqual({ ok: false, code: 'bucket_unknown' })
    expect(
      await admin.resetQuotaPeriod(userId, { ruleId: 'r-each', bucketKey: 'ghost-model' }, userId),
    ).toEqual({ ok: false, code: 'bucket_unknown' })
    // 次数没有小数
    expect(
      await admin.createQuotaGrant(
        userId,
        { ruleId: 'r-each', bucketKey: modelId, amount: 1.5 },
        userId,
      ),
    ).toEqual({ ok: false, code: 'amount_not_integer' })
  })

  it('单桶重置只影响目标桶', async () => {
    const first = await createModel()
    const second = await createModel()
    const policy = await admin.createQuotaPolicy({
      name: 'A',
      isDefault: false,
      rules: [perModelRequests([first, second], 1)],
    })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )
    await logUsage(userId, first)
    await logUsage(userId, second)

    const result = await admin.resetQuotaPeriod(
      userId,
      { ruleId: 'r-each', bucketKey: first },
      userId,
    )
    expect(result).toEqual({ ok: true, resetRules: 1 })

    const snapshot = await quota.getQuotaSnapshot(userId)
    const byBucket = new Map(snapshot.rules.map((rule) => [rule.bucketKey, rule]))
    expect(byBucket.get(first)?.used).toBe(0)
    expect(byBucket.get(second)?.used).toBe(1)
    expect(snapshot.blockedModelIds).toEqual([second])
  })

  it('滚动窗口重置按原窗口长度到期，改为永久累计后不会复活', async () => {
    const modelId = await createModel()
    const rollingRule: QuotaRule = {
      ...monthlyCost(10, 'r-rolling'),
      window: { type: 'rolling', hours: 5 },
    }
    const policy = await admin.createQuotaPolicy({ name: '滚动窗口', rules: [rollingRule] })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )
    await logUsage(userId, modelId, 1)

    expect(await admin.resetQuotaPeriod(userId, { ruleId: rollingRule.id }, userId)).toEqual({
      ok: true,
      resetRules: 1,
    })
    const reset = (await admin.getAdminUserQuotaDetail(userId))?.adjustments.find(
      (row) => row.kind === 'reset',
    )
    expect(reset?.expiresAt).toBe((reset?.effectiveFrom ?? 0) + 5 * 3_600_000)

    await admin.updateQuotaPolicy(policy.id, {
      rules: [{ ...rollingRule, window: { type: 'total' } }],
    })
    const snapshot = await quota.getQuotaSnapshot(userId, { now: (reset?.expiresAt ?? 0) + 1 })
    expect(snapshot.rules[0]?.usageStart).toBe(0)
    expect(snapshot.rules[0]?.used).toBe(1)
  })

  it('没有任何规则时重置给出明确错误', async () => {
    const userId = await createUser()
    expect(await admin.resetQuotaPeriod(userId, {}, userId)).toEqual({
      ok: false,
      code: 'no_rules',
    })
  })

  it('首次请求周期未启动时拒绝赠送与重置，启动后恢复可操作', async () => {
    const modelId = await createModel()
    const policy = await admin.createQuotaPolicy({
      name: '首次请求周期',
      rules: [
        {
          id: 'r-anchored',
          label: null,
          scope: { type: 'all' },
          metric: 'requests',
          limit: { kind: 'amount', value: 5 },
          window: { type: 'anchored', hours: 5 },
          priority: 0,
        },
      ],
    })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )

    expect(
      await admin.createQuotaGrant(userId, { ruleId: 'r-anchored', amount: 1 }, userId),
    ).toEqual({ ok: false, code: 'period_not_started' })
    expect(await admin.resetQuotaPeriod(userId, { ruleId: 'r-anchored' }, userId)).toEqual({
      ok: false,
      code: 'period_not_started',
    })

    const admission = await quota.prepareQuotaAdmission(userId, modelId)
    quota.activateQuotaCycles(userId, admission.cycleClaims, new Date())
    expect(
      await admin.createQuotaGrant(userId, { ruleId: 'r-anchored', amount: 1 }, userId),
    ).toMatchObject({ ok: true })
    expect(await admin.resetQuotaPeriod(userId, { ruleId: 'r-anchored' }, userId)).toEqual({
      ok: true,
      resetRules: 1,
    })
  })

  it('首次请求周期手动重置后清空锚点，等下一次请求再起算', async () => {
    const modelId = await createModel()
    const policy = await admin.createQuotaPolicy({
      name: '首次请求周期',
      rules: [
        {
          id: 'r-anchored',
          label: null,
          scope: { type: 'all' },
          metric: 'requests',
          limit: { kind: 'amount', value: 1 },
          window: { type: 'anchored', hours: 5 },
          priority: 0,
        },
      ],
    })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )

    const firstStart = new Date()
    const admission = await quota.prepareQuotaAdmission(userId, modelId)
    quota.activateQuotaCycles(userId, admission.cycleClaims, firstStart)
    await logUsage(userId, modelId, 0, { createdAt: firstStart.getTime() })

    const before = await quota.getQuotaSnapshot(userId)
    expect(before.rules[0]).toMatchObject({
      periodActive: true,
      periodStart: firstStart.getTime(),
      used: 1,
      blocked: true,
    })

    expect(await admin.resetQuotaPeriod(userId, { ruleId: 'r-anchored' }, userId)).toEqual({
      ok: true,
      resetRules: 1,
    })

    const afterReset = await quota.getQuotaSnapshot(userId)
    expect(afterReset.rules[0]).toMatchObject({
      periodActive: false,
      periodStart: 0,
      periodEnd: null,
      usageStart: 0,
      used: 0,
      blocked: false,
    })
    expect(
      await dbClient.db
        .select({ ruleId: schema.quotaCycles.ruleId })
        .from(schema.quotaCycles)
        .where(eq(schema.quotaCycles.userId, userId)),
    ).toEqual([])
    expect(
      (await admin.getAdminUserQuotaDetail(userId))?.adjustments.filter((row) => row.kind === 'reset'),
    ).toEqual([])

    const nextStart = new Date()
    quota.activateQuotaCycles(userId, admission.cycleClaims, nextStart)
    const afterNext = await quota.getQuotaSnapshot(userId)
    expect(afterNext.rules[0]).toMatchObject({
      periodActive: true,
      periodStart: nextStart.getTime(),
      periodEnd: nextStart.getTime() + 5 * 3_600_000,
      usageStart: nextStart.getTime(),
      used: 0,
      blocked: false,
    })
  })

  it('首次请求周期只重置一个独立桶时，其他桶的锚点保持', async () => {
    const modelA = await createModel()
    const modelB = await createModel()
    const policy = await admin.createQuotaPolicy({
      name: '各自独立固定周期',
      rules: [
        {
          id: 'r-each',
          label: null,
          scope: { type: 'models', modelIds: [modelA, modelB], mode: 'each' },
          metric: 'requests',
          limit: { kind: 'amount', value: 1 },
          window: { type: 'anchored', hours: 5 },
          priority: 0,
        },
      ],
    })
    const userId = await createUser()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )

    const startedAt = new Date()
    quota.activateQuotaCycles(
      userId,
      [
        { ruleId: 'r-each', bucketKey: modelA, windowHours: 5 },
        { ruleId: 'r-each', bucketKey: modelB, windowHours: 5 },
      ],
      startedAt,
    )

    expect(
      await admin.resetQuotaPeriod(userId, { ruleId: 'r-each', bucketKey: modelA }, userId),
    ).toEqual({ ok: true, resetRules: 1 })

    const snapshot = await quota.getQuotaSnapshot(userId)
    const byBucket = new Map(snapshot.rules.map((rule) => [rule.bucketKey, rule]))
    expect(byBucket.get(modelA)).toMatchObject({ periodActive: false, usageStart: 0 })
    expect(byBucket.get(modelB)).toMatchObject({
      periodActive: true,
      periodStart: startedAt.getTime(),
    })
  })
})

describe('列表 / 明细 / 预览', () => {
  it('用户列表的最近使用取最新用量日志，而不是最近登录时间', async () => {
    const loginAt = Date.UTC(2026, 7, 8, 2, 35, 1)
    const firstUsageAt = Date.UTC(2026, 7, 13, 15, 20, 54)
    const latestUsageAt = Date.UTC(2026, 7, 13, 16, 35, 29)
    const userId = await createUser('user', loginAt)
    const modelId = await createModel()
    await logUsage(userId, modelId, 1, { createdAt: firstUsageAt })
    // 与请求事件/分用户统计保持一致：失败的模型请求也是一次最近使用。
    await logUsage(userId, modelId, 0, { createdAt: latestUsageAt, success: false })

    const rows = await admin.listAdminUserQuotas()
    const row = rows.find((item) => item.userId === userId)

    expect(row?.lastUsageAt).toBe(latestUsageAt)
    expect(row?.lastUsageAt).not.toBe(loginAt)
  })

  it('用户列表头像地址与账号中心同源，未上传则为空', async () => {
    const userId = await createUser()
    await dbClient.db
      .update(schema.users)
      .set({ avatarPath: join('data', 'uploads', userId, 'fresh-avatar.webp') })
      .where(eq(schema.users.id, userId))

    const rows = await admin.listAdminUserQuotas()
    const row = rows.find((item) => item.userId === userId)
    expect(row?.avatarUrl).toBe(`/api/auth/avatar/${userId}?v=fresh-avatar.webp`)
  })

  it('用户列表给出全部额度桶，并保持策略展示顺序', async () => {
    const userId = await createUser()
    const modelId = await createModel()
    const policy = await admin.createQuotaPolicy({
      name: 'A',
      rules: [perModelRequests([modelId], 100), monthlyCost(10)],
    })
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )
    await logUsage(userId, modelId, 10)

    const rows = await admin.listAdminUserQuotas()
    const row = rows.find((item) => item.userId === userId)
    expect(row?.policyName).toBe('A')
    expect(row?.avatarUrl).toBeNull()
    expect(row?.usingDefaultPolicy).toBe(false)
    expect(row?.blocked).toBe(true)
    expect(row?.rules.map((rule) => rule.ruleId)).toEqual(['r-each', 'r-cost'])
    expect(row?.rules[0]).toMatchObject({ ruleId: 'r-each', used: 1, blocked: false })
    expect(row?.rules[1]).toMatchObject({ ruleId: 'r-cost', blocked: true, percent: 1 })
  })

  it('预览用草稿规则按真实用量算出「保存后立即耗尽」', async () => {
    const policy = await admin.createQuotaPolicy({ name: 'A', rules: [monthlyCost(50)] })
    const userId = await createUser()
    const modelId = await createModel()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )
    await logUsage(userId, modelId, 20)

    const preview = await admin.previewUserQuota({
      userId,
      policyId: policy.id,
      overrides: { rules: { 'r-cost': { limit: { kind: 'amount', value: 10 } } } },
      enforcementPaused: false,
    })
    expect(preview?.rules[0]?.effectiveLimit).toBe(10)
    expect(preview?.rules[0]?.used).toBeCloseTo(20)
    expect(preview?.blockedRules).toHaveLength(1)

    const relaxed = await admin.previewUserQuota({
      userId,
      policyId: policy.id,
      overrides: { rules: { 'r-cost': { limit: { kind: 'unlimited' } } } },
      enforcementPaused: false,
    })
    expect(relaxed?.unlimited).toBe(true)
    expect(relaxed?.blockedRules).toHaveLength(0)
  })

  it('预览支持尚未保存的策略草稿', async () => {
    const userId = await createUser()
    const modelId = await createModel()
    await logUsage(userId, modelId, 5)

    const preview = await admin.previewUserQuota({
      userId,
      policyId: null,
      overrides: {},
      enforcementPaused: false,
      draftRules: [monthlyCost(4)],
    })
    expect(preview?.rules).toHaveLength(1)
    expect(preview?.blockedRules).toHaveLength(1)
  })

  it('明细包含生效规则、调整记录与分模型构成', async () => {
    const policy = await admin.createQuotaPolicy({ name: 'A', rules: [monthlyCost(10)] })
    const userId = await createUser()
    const modelId = await createModel()
    await admin.updateUserQuota(
      userId,
      { policyId: policy.id, overrides: {}, enforcementPaused: false },
      userId,
    )
    await logUsage(userId, modelId, 3)
    await admin.createQuotaGrant(userId, { ruleId: 'r-cost', amount: 2, note: '临时' }, userId)

    const detail = await admin.getAdminUserQuotaDetail(userId)
    expect(detail?.effectiveRules).toHaveLength(1)
    expect(detail?.rules[0]?.granted).toBe(2)
    expect(detail?.adjustments[0]?.note).toBe('临时')
    expect(detail?.byModel[0]?.requests).toBe(1)
    expect(await admin.getAdminUserQuotaDetail('ghost')).toBeNull()
  })
})
