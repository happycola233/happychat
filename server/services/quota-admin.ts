import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type {
  AdminQuotaPolicyDTO,
  AdminUserQuotaDTO,
  AdminUserQuotaDetailDTO,
  QuotaAdjustmentDTO,
  QuotaPolicyDTO,
  QuotaPreviewDTO,
} from '@shared/types/api'
import type { EffectiveQuotaRule, QuotaRule } from '@shared/types/domain'
import type {
  QuotaGrantCreateInput,
  QuotaPolicyCreateInput,
  QuotaPolicyUpdateInput,
  QuotaPreviewInput,
  QuotaResetInput,
  UserQuotaUpdateInput,
} from '@shared/schemas/quota'
import {
  isQuotaUnlimited,
  normalizeQuotaRules,
  normalizeUserQuotaOverrides,
  quotaRuleRequiresBucketKey,
  resolveEffectiveQuota,
} from '@shared/util/quota'
import { resolveQuotaPeriod } from '@shared/util/quotaWindow'
import { db } from '../db/client'
import { quotaAdjustments, quotaPolicies, userQuotas, users } from '../db/schema'
import { must } from '../lib/assert'
import { newId } from '../lib/id'
import {
  getQuotaConfig,
  getQuotaSnapshot,
  getUserQuotaBinding,
  listQuotaAdjustments,
  sortQuotaBucketsBySeverity,
  type QuotaAdjustmentRow,
} from './quota'
import { getUserModelUsage } from './usage-stats'

type PolicyRow = typeof quotaPolicies.$inferSelect

/** 排序沿用 models / model_groups 的稀疏步长约定，插队时不必整体重排。 */
const SORT_STEP = 100

function toPolicyDTO(row: PolicyRow): QuotaPolicyDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // 读取边界统一归一化：手工改库或旧版本残留的脏规则不会流到管理界面。
    rules: normalizeQuotaRules(row.rules),
    isDefault: row.isDefault,
    sort: row.sort,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

/**
 * 策略列表 + 绑定人数。
 * 默认策略的人数含「未显式绑定任何策略」的用户——他们实际受该策略约束，
 * 只统计显式绑定会让默认策略看起来没人用。
 */
export async function listQuotaPolicies(): Promise<AdminQuotaPolicyDTO[]> {
  const rows = await db
    .select()
    .from(quotaPolicies)
    .orderBy(asc(quotaPolicies.sort), asc(quotaPolicies.createdAt))
  const explicitCounts = await db
    .select({ policyId: userQuotas.policyId, count: sql<number>`count(*)` })
    .from(userQuotas)
    .groupBy(userQuotas.policyId)
  const countByPolicy = new Map(
    explicitCounts.filter((row) => row.policyId).map((row) => [row.policyId!, row.count]),
  )
  const [totalUsers] = await db.select({ count: sql<number>`count(*)` }).from(users)
  const explicitTotal = explicitCounts
    .filter((row) => row.policyId)
    .reduce((sum, row) => sum + row.count, 0)
  const followingDefault = Math.max(0, (totalUsers?.count ?? 0) - explicitTotal)

  return rows.map((row) => ({
    ...toPolicyDTO(row),
    boundUserCount: (countByPolicy.get(row.id) ?? 0) + (row.isDefault ? followingDefault : 0),
  }))
}

async function nextPolicySort(): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${quotaPolicies.sort})` })
    .from(quotaPolicies)
  return (row?.max ?? 0) + SORT_STEP
}

/** 设为默认策略：同一事务内清掉旧默认，保证「至多一条 isDefault」。 */
function markDefaultWithin(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  policyId: string,
): void {
  tx.update(quotaPolicies)
    .set({ isDefault: false })
    .where(and(eq(quotaPolicies.isDefault, true), sql`${quotaPolicies.id} <> ${policyId}`))
    .run()
  tx.update(quotaPolicies).set({ isDefault: true }).where(eq(quotaPolicies.id, policyId)).run()
}

/** 服务层入参：`isDefault` 可省略（内部调用如「复制策略」不需要显式传 false）。 */
export type CreateQuotaPolicyInput = Omit<QuotaPolicyCreateInput, 'isDefault'> & {
  isDefault?: boolean
}

export async function createQuotaPolicy(input: CreateQuotaPolicyInput): Promise<QuotaPolicyDTO> {
  const sort = await nextPolicySort()
  const id = newId()
  const row = db.transaction(
    (tx) => {
      const created = must(
        tx
          .insert(quotaPolicies)
          .values({
            id,
            name: input.name,
            description: input.description ?? null,
            rules: input.rules,
            isDefault: false,
            sort,
          })
          .returning()
          .get(),
      )
      if (input.isDefault) markDefaultWithin(tx, id)
      return must(tx.select().from(quotaPolicies).where(eq(quotaPolicies.id, created.id)).get())
    },
    { behavior: 'immediate' },
  )
  return toPolicyDTO(row)
}

export type UpdatePolicyResult =
  | { ok: true; policy: QuotaPolicyDTO }
  | { ok: false; code: 'policy_missing' }

export async function updateQuotaPolicy(
  id: string,
  input: QuotaPolicyUpdateInput,
): Promise<UpdatePolicyResult> {
  const result = db.transaction(
    (tx) => {
      const existing = tx.select().from(quotaPolicies).where(eq(quotaPolicies.id, id)).get()
      if (!existing) return { ok: false, code: 'policy_missing' } as const
      const patch: Partial<typeof quotaPolicies.$inferInsert> = { updatedAt: new Date() }
      if (input.name !== undefined) patch.name = input.name
      if (input.description !== undefined) patch.description = input.description
      if (input.rules !== undefined) patch.rules = input.rules
      tx.update(quotaPolicies).set(patch).where(eq(quotaPolicies.id, id)).run()
      return {
        ok: true,
        policy: must(tx.select().from(quotaPolicies).where(eq(quotaPolicies.id, id)).get()),
      } as const
    },
    { behavior: 'immediate' },
  )
  return result.ok ? { ok: true, policy: toPolicyDTO(result.policy) } : result
}

export type DeletePolicyResult =
  | { ok: true; releasedUsers: number }
  | { ok: false; code: 'policy_missing' | 'last_default_policy' }

/**
 * 删除策略：组内用户回退到默认策略。
 *
 * FK 已是 `set null`，但仍显式更新并**保留各行原 `updatedAt`**——策略被删不等于
 * 用户配置刚被人改过（与 `deleteModelGroup` 对会话的处理同理）。
 * 唯一的默认策略不允许删除：否则所有未显式绑定的用户会突然变成无限额度。
 */
export async function deleteQuotaPolicy(id: string): Promise<DeletePolicyResult> {
  return db.transaction(
    (tx): DeletePolicyResult => {
      const existing = tx.select().from(quotaPolicies).where(eq(quotaPolicies.id, id)).get()
      if (!existing) return { ok: false, code: 'policy_missing' }
      if (existing.isDefault) {
        const [others] = tx
          .select({ count: sql<number>`count(*)` })
          .from(quotaPolicies)
          .where(sql`${quotaPolicies.id} <> ${id}`)
          .all()
        if ((others?.count ?? 0) > 0) return { ok: false, code: 'last_default_policy' }
      }

      const bound = tx
        .select({ userId: userQuotas.userId, updatedAt: userQuotas.updatedAt })
        .from(userQuotas)
        .where(eq(userQuotas.policyId, id))
        .all()
      for (const row of bound) {
        tx.update(userQuotas)
          .set({ policyId: null, updatedAt: row.updatedAt })
          .where(eq(userQuotas.userId, row.userId))
          .run()
      }
      tx.delete(quotaPolicies).where(eq(quotaPolicies.id, id)).run()
      return { ok: true, releasedUsers: bound.length }
    },
    { behavior: 'immediate' },
  )
}

export type DuplicatePolicyResult =
  | { ok: true; policy: QuotaPolicyDTO }
  | { ok: false; code: 'policy_missing' }

/** 复制策略：规则 id 全部重新生成，避免两份策略共用同一个覆写/临时额度绑定键。 */
export async function duplicateQuotaPolicy(id: string): Promise<DuplicatePolicyResult> {
  const [source] = await db.select().from(quotaPolicies).where(eq(quotaPolicies.id, id)).limit(1)
  if (!source) return { ok: false, code: 'policy_missing' }
  const rules: QuotaRule[] = normalizeQuotaRules(source.rules).map((rule) => ({
    ...rule,
    id: newId(),
  }))
  const created = await createQuotaPolicy({
    name: `${source.name} 副本`.slice(0, 40),
    description: source.description,
    rules,
  })
  return { ok: true, policy: created }
}

export type SetDefaultPolicyResult = { ok: true } | { ok: false; code: 'policy_missing' }

export async function setDefaultQuotaPolicy(id: string): Promise<SetDefaultPolicyResult> {
  return db.transaction(
    (tx): SetDefaultPolicyResult => {
      const existing = tx
        .select({ id: quotaPolicies.id })
        .from(quotaPolicies)
        .where(eq(quotaPolicies.id, id))
        .get()
      if (!existing) return { ok: false, code: 'policy_missing' }
      markDefaultWithin(tx, id)
      return { ok: true }
    },
    { behavior: 'immediate' },
  )
}

export type ReorderPoliciesResult =
  | { ok: true }
  | { ok: false; code: 'invalid_order'; invalidIds: string[] }

/** 与模型/分组排序同契约：必须提交穷尽的完整 id 列表。 */
export async function reorderQuotaPolicies(policyIds: string[]): Promise<ReorderPoliciesResult> {
  const existing = await db.select({ id: quotaPolicies.id }).from(quotaPolicies)
  const existingIds = new Set(existing.map((row) => row.id))
  const submitted = new Set(policyIds)
  const unknown = policyIds.filter((id) => !existingIds.has(id))
  const omitted = existing.map((row) => row.id).filter((id) => !submitted.has(id))
  if (unknown.length || omitted.length) {
    return { ok: false, code: 'invalid_order', invalidIds: [...unknown, ...omitted] }
  }
  db.transaction((tx) => {
    for (const [index, id] of policyIds.entries()) {
      tx.update(quotaPolicies)
        .set({ sort: (index + 1) * SORT_STEP })
        .where(eq(quotaPolicies.id, id))
        .run()
    }
  })
  return { ok: true }
}

// ---------------- 用户绑定 / 覆写 ----------------

export type UpdateUserQuotaResult =
  | { ok: true }
  | { ok: false; code: 'user_missing' | 'policy_missing' }

/**
 * 写入用户级配置（策略绑定 + 覆写 + 暂停）。
 * 「暂停限额」只影响拦截判定，用量照常累计；这里同时记录操作者与时间用于界面说明。
 */
export async function updateUserQuota(
  userId: string,
  input: UserQuotaUpdateInput,
  actorId: string,
): Promise<UpdateUserQuotaResult> {
  const overrides = normalizeUserQuotaOverrides(input.overrides)
  return db.transaction(
    (tx): UpdateUserQuotaResult => {
      const user = tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).get()
      if (!user) return { ok: false, code: 'user_missing' }
      if (input.policyId) {
        const policy = tx
          .select({ id: quotaPolicies.id })
          .from(quotaPolicies)
          .where(eq(quotaPolicies.id, input.policyId))
          .get()
        if (!policy) return { ok: false, code: 'policy_missing' }
      }
      const existing = tx.select().from(userQuotas).where(eq(userQuotas.userId, userId)).get()
      // 暂停时间只在「从未暂停 → 暂停」时刷新，反复保存其他字段不会把计时清零。
      const pausedAt = input.enforcementPaused
        ? existing?.enforcementPaused
          ? existing.pausedAt
          : new Date()
        : null
      const values = {
        userId,
        policyId: input.policyId,
        overrides,
        enforcementPaused: input.enforcementPaused,
        pausedAt,
        pausedBy: input.enforcementPaused ? actorId : null,
        note: input.note ?? null,
        updatedAt: new Date(),
      }
      if (existing) {
        tx.update(userQuotas).set(values).where(eq(userQuotas.userId, userId)).run()
      } else {
        tx.insert(userQuotas).values(values).run()
      }
      return { ok: true }
    },
    { behavior: 'immediate' },
  )
}

export type BatchAssignResult =
  | { ok: true; updated: number }
  | { ok: false; code: 'unknown_users'; invalidIds: string[] }
  | { ok: false; code: 'policy_missing' }

/** 批量修改策略：任一用户不存在则整批失败，不留「改了一半」的中间态。 */
export async function batchAssignQuotaPolicy(
  userIds: string[],
  policyId: string | null,
): Promise<BatchAssignResult> {
  return db.transaction(
    (tx): BatchAssignResult => {
      if (policyId) {
        const policy = tx
          .select({ id: quotaPolicies.id })
          .from(quotaPolicies)
          .where(eq(quotaPolicies.id, policyId))
          .get()
        if (!policy) return { ok: false, code: 'policy_missing' }
      }
      const existingUsers = new Set(
        tx
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, userIds))
          .all()
          .map((row) => row.id),
      )
      const invalidIds = userIds.filter((id) => !existingUsers.has(id))
      if (invalidIds.length > 0) return { ok: false, code: 'unknown_users', invalidIds }

      const configured = new Set(
        tx
          .select({ userId: userQuotas.userId })
          .from(userQuotas)
          .where(inArray(userQuotas.userId, userIds))
          .all()
          .map((row) => row.userId),
      )
      const now = new Date()
      for (const userId of userIds) {
        if (configured.has(userId)) {
          // 只改策略绑定：覆写与暂停状态属于用户自己的配置，批量指派不该顺手清掉。
          tx.update(userQuotas)
            .set({ policyId, updatedAt: now })
            .where(eq(userQuotas.userId, userId))
            .run()
        } else {
          tx.insert(userQuotas).values({ userId, policyId, updatedAt: now }).run()
        }
      }
      return { ok: true, updated: userIds.length }
    },
    { behavior: 'immediate' },
  )
}

// ---------------- 临时额度 / 手动重置 ----------------

/** 在给定规则集合中查找目标规则，并校验桶绑定是否合法。 */
function findRuleForAdjustment(
  rules: EffectiveQuotaRule[],
  ruleId: string,
  bucketKey: string | null,
):
  | { ok: true; rule: EffectiveQuotaRule }
  | { ok: false; code: 'rule_missing' | 'bucket_required' } {
  const rule = rules.find((item) => item.id === ruleId)
  if (!rule) return { ok: false, code: 'rule_missing' }
  if (quotaRuleRequiresBucketKey(rule) && !bucketKey) return { ok: false, code: 'bucket_required' }
  return { ok: true, rule }
}

export type CreateGrantResult =
  | { ok: true; grant: QuotaAdjustmentDTO }
  | { ok: false; code: 'rule_missing' | 'bucket_required' | 'unlimited_rule' }

/**
 * 临时增加额度：只作用于**当前周期**。
 *
 * 失效方式有两道保险：`expiresAt`（日历周期=周期结束、滚动窗口=当前时刻+窗口长度）
 * 与 `periodStart`（周期切换后即失效）。因此赠送不会污染长期配置，也不会跨周期复活。
 */
export async function createQuotaGrant(
  userId: string,
  input: QuotaGrantCreateInput,
  actorId: string,
): Promise<CreateGrantResult> {
  const config = await getQuotaConfig()
  const binding = await getUserQuotaBinding(userId)
  const found = findRuleForAdjustment(binding.rules, input.ruleId, input.bucketKey ?? null)
  if (!found.ok) return found
  if (found.rule.limit.kind === 'unlimited') return { ok: false, code: 'unlimited_rule' }

  const now = new Date()
  const period = resolveQuotaPeriod(found.rule.window, now.getTime(), {
    timezone: config.quotaTimezone,
    weekStart: config.quotaWeekStart,
  })
  const expiresAt =
    period.endMs !== null
      ? new Date(period.endMs)
      : found.rule.window.type === 'rolling'
        ? new Date(now.getTime() + found.rule.window.hours * 3_600_000)
        : null

  const row = must(
    await db
      .insert(quotaAdjustments)
      .values({
        userId,
        kind: 'grant',
        ruleId: found.rule.id,
        bucketKey: input.bucketKey ?? null,
        metric: found.rule.metric,
        amount: input.amount,
        effectiveFrom: now,
        periodStart: new Date(period.startMs),
        expiresAt,
        note: input.note ?? null,
        createdBy: actorId,
      })
      .returning()
      .then((rows) => rows[0]),
  )
  return {
    ok: true,
    grant: {
      id: row.id,
      kind: 'grant',
      ruleId: row.ruleId,
      bucketKey: row.bucketKey,
      metric: row.metric,
      amount: row.amount ?? 0,
      note: row.note,
      expiresAt: row.expiresAt?.getTime() ?? null,
      effectiveFrom: row.effectiveFrom.getTime(),
      periodStart: row.periodStart.getTime(),
      createdAt: row.createdAt.getTime(),
      createdByName: null,
      active: true,
    },
  }
}

export async function revokeQuotaAdjustment(id: string): Promise<boolean> {
  const deleted = await db
    .delete(quotaAdjustments)
    .where(eq(quotaAdjustments.id, id))
    .returning({ id: quotaAdjustments.id })
  return deleted.length > 0
}

export type ResetPeriodResult =
  | { ok: true; resetRules: number }
  | { ok: false; code: 'rule_missing' | 'bucket_required' | 'no_rules' }

/**
 * 手动重置当前周期：写 `reset` 记录把统计起点抬到此刻，**不删除任何用量日志**，
 * 因此后台统计与审计口径完全不受影响。ruleId 省略时重置该用户的全部规则。
 */
export async function resetQuotaPeriod(
  userId: string,
  input: QuotaResetInput,
  actorId: string,
): Promise<ResetPeriodResult> {
  const config = await getQuotaConfig()
  const binding = await getUserQuotaBinding(userId)
  if (binding.rules.length === 0) return { ok: false, code: 'no_rules' }

  const targets: { rule: EffectiveQuotaRule; bucketKey: string | null }[] = []
  if (input.ruleId) {
    const found = findRuleForAdjustment(binding.rules, input.ruleId, input.bucketKey ?? null)
    if (!found.ok) return found
    targets.push({ rule: found.rule, bucketKey: input.bucketKey ?? null })
  } else {
    // 「重置全部」对每条规则各写一条记录：不同规则的周期起点不同，一条记录无法覆盖。
    for (const rule of binding.rules) targets.push({ rule, bucketKey: null })
  }

  const now = new Date()
  db.transaction((tx) => {
    for (const target of targets) {
      const period = resolveQuotaPeriod(target.rule.window, now.getTime(), {
        timezone: config.quotaTimezone,
        weekStart: config.quotaWeekStart,
      })
      tx.insert(quotaAdjustments)
        .values({
          userId,
          kind: 'reset',
          ruleId: target.rule.id,
          bucketKey: target.bucketKey,
          metric: target.rule.metric,
          amount: null,
          effectiveFrom: now,
          periodStart: new Date(period.startMs),
          expiresAt: period.endMs !== null ? new Date(period.endMs) : null,
          note: input.note ?? null,
          createdBy: actorId,
        })
        .run()
    }
  })
  return { ok: true, resetRules: targets.length }
}

// ---------------- 列表 / 明细 / 预览 ----------------

function toAdjustmentDTO(
  row: QuotaAdjustmentRow,
  currentPeriodStarts: Set<number>,
  now: number,
): QuotaAdjustmentDTO {
  return {
    id: row.id,
    kind: row.kind,
    ruleId: row.ruleId,
    bucketKey: row.bucketKey,
    metric: row.metric,
    amount: row.amount ?? 0,
    note: row.note,
    expiresAt: row.expiresAt,
    effectiveFrom: row.effectiveFrom,
    periodStart: row.periodStart,
    createdAt: row.createdAt,
    createdByName: row.createdByName,
    active:
      currentPeriodStarts.has(row.periodStart) && (row.expiresAt === null || row.expiresAt > now),
  }
}

/** 管理端用户列表：每人一次快照（含用量），并给出最紧张的一条规则用于进度条。 */
export async function listAdminUserQuotas(): Promise<AdminUserQuotaDTO[]> {
  const config = await getQuotaConfig()
  const userRows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      disabled: users.disabled,
      lastActiveAt: users.lastActiveAt,
    })
    .from(users)
    .orderBy(asc(users.username))

  const result: AdminUserQuotaDTO[] = []
  for (const user of userRows) {
    const binding = await getUserQuotaBinding(user.id)
    const snapshot = await getQuotaSnapshot(user.id, { config, binding })
    const highlight = sortQuotaBucketsBySeverity(snapshot.rules).find(
      (rule) => rule.limit.kind === 'amount' && !rule.invalid,
    )
    result.push({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      disabled: user.disabled,
      policyId: binding.policyId,
      policyName: binding.policyName,
      usingDefaultPolicy: binding.usingDefaultPolicy,
      enforcementPaused: binding.enforcementPaused,
      pausedAt: binding.pausedAt,
      note: binding.note,
      unlimited: snapshot.unlimited,
      overrideCount:
        Object.keys(binding.overrides.rules ?? {}).length +
        (binding.overrides.extraRules?.length ?? 0),
      highlight: highlight ?? null,
      blocked: snapshot.blockedModelIds.length > 0,
      lastActiveAt: user.lastActiveAt?.getTime() ?? null,
    })
  }
  return result
}

export async function getAdminUserQuotaDetail(
  userId: string,
  options: { days?: number } = {},
): Promise<AdminUserQuotaDetailDTO | null> {
  const [user] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) return null

  const config = await getQuotaConfig()
  const binding = await getUserQuotaBinding(userId)
  const adjustments = await listQuotaAdjustments(userId)
  const snapshot = await getQuotaSnapshot(userId, { config, binding, adjustments })
  const now = Date.now()
  const currentPeriodStarts = new Set(snapshot.rules.map((rule) => rule.periodStart))

  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    policyId: binding.policyId,
    policyName: binding.policyName,
    usingDefaultPolicy: binding.usingDefaultPolicy,
    enforcementPaused: binding.enforcementPaused,
    pausedAt: binding.pausedAt,
    note: binding.note,
    overrides: binding.overrides,
    effectiveRules: binding.rules,
    rules: sortQuotaBucketsBySeverity(snapshot.rules),
    adjustments: adjustments.map((row) => toAdjustmentDTO(row, currentPeriodStarts, now)),
    byModel: await getUserModelUsage(userId, options.days ?? 30),
  }
}

/**
 * 保存前预览：用草稿策略/覆写按**真实用量**算一遍最终生效结果，
 * 让管理员在点保存前就看到「张三保存后立即处于已耗尽状态」。
 */
export async function previewUserQuota(input: QuotaPreviewInput): Promise<QuotaPreviewDTO | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1)
  if (!user) return null

  const config = await getQuotaConfig()
  const policyRules =
    input.draftRules ??
    (await (async () => {
      const [policy] = input.policyId
        ? await db.select().from(quotaPolicies).where(eq(quotaPolicies.id, input.policyId)).limit(1)
        : await db.select().from(quotaPolicies).where(eq(quotaPolicies.isDefault, true)).limit(1)
      return normalizeQuotaRules(policy?.rules)
    })())
  const rules = resolveEffectiveQuota(
    normalizeQuotaRules(policyRules),
    normalizeUserQuotaOverrides(input.overrides),
  )
  const snapshot = await getQuotaSnapshot(input.userId, {
    config,
    rulesOverride: rules,
    pausedOverride: input.enforcementPaused,
  })
  const sorted = sortQuotaBucketsBySeverity(snapshot.rules)
  return {
    unlimited: isQuotaUnlimited(rules),
    rules: sorted,
    blockedRules: sorted.filter((rule) => rule.blocked && !rule.invalid),
  }
}

/** 供测试与路由层读取单个策略。 */
export async function getQuotaPolicy(id: string): Promise<QuotaPolicyDTO | null> {
  const [row] = await db.select().from(quotaPolicies).where(eq(quotaPolicies.id, id)).limit(1)
  return row ? toPolicyDTO(row) : null
}
