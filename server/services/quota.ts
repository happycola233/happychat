import { and, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm'
import type {
  AppConfigDTO,
  MyQuotaDTO,
  QuotaBucketUsageDTO,
  QuotaGrantDTO,
} from '@shared/types/api'
import type {
  EffectiveQuotaRule,
  ModelPricing,
  QuotaAdjustmentKind,
  QuotaMetric,
  UserQuotaOverrides,
} from '@shared/types/domain'
import { costUsd } from '@shared/util/cost'
import {
  evaluateQuotaLimit,
  formatQuotaAmount,
  isQuotaUnlimited,
  normalizeQuotaRules,
  normalizeUserQuotaOverrides,
  resolveEffectiveQuota,
} from '@shared/util/quota'
import { describeQuotaWindow, resolveQuotaPeriod } from '@shared/util/quotaWindow'
import { db } from '../db/client'
import {
  modelGroups,
  modelUserAccess,
  models,
  providers,
  quotaAdjustments,
  quotaPolicies,
  runs,
  usageLogs,
  userQuotas,
  users,
} from '../db/schema'
import { getAppConfig } from './appConfig'
import { accessJoinForUser, accessibleToUser } from './models'

/** 限额相关的全局配置切片；快照与判定只依赖这几项。 */
export type QuotaConfig = Pick<
  AppConfigDTO,
  'quotaEnabled' | 'quotaTimezone' | 'quotaWeekStart' | 'quotaWarnThreshold'
>

/** 参与判定的用户级配置（无 user_quotas 行时即为等价默认值）。 */
export interface UserQuotaBinding {
  policyId: string | null
  policyName: string | null
  usingDefaultPolicy: boolean
  enforcementPaused: boolean
  pausedAt: number | null
  note: string | null
  overrides: UserQuotaOverrides
  rules: EffectiveQuotaRule[]
}

/** 周期调整记录（临时额度 / 手动重置）的服务层行形态。 */
export interface QuotaAdjustmentRow {
  id: string
  kind: QuotaAdjustmentKind
  ruleId: string | null
  bucketKey: string | null
  metric: QuotaMetric
  amount: number | null
  effectiveFrom: number
  periodStart: number
  expiresAt: number | null
  note: string | null
  createdAt: number
  createdByName: string | null
}

interface QuotaModelRow {
  id: string
  displayName: string
  groupId: string | null
}

/** 一个额度桶：规则 + 具体目标 + 参与统计的模型集合（null=全部模型）。 */
interface QuotaBucket {
  rule: EffectiveQuotaRule
  bucketKey: string | null
  bucketLabel: string | null
  /** 参与统计的模型 DB id；null 表示「全部模型」（含已删除模型留下的历史用量） */
  modelIds: string[] | null
  periodStart: number
  periodEnd: number | null
  /** 扣除手动重置后的实际统计起点 */
  usageStart: number
  invalid: boolean
  /** 桶内所有模型都被更高优先级规则接管：不计量也不拦截 */
  shadowed: boolean
}

interface UsageAggregate {
  totalRequests: number
  totalCost: number
  requestsByModel: Map<string, number>
  costByModel: Map<string, number>
}

const PENDING_RUN_STATES = ['queued', 'running'] as const

export async function getQuotaConfig(): Promise<QuotaConfig> {
  const config = await getAppConfig()
  return {
    quotaEnabled: config.quotaEnabled,
    quotaTimezone: config.quotaTimezone,
    quotaWeekStart: config.quotaWeekStart,
    quotaWarnThreshold: config.quotaWarnThreshold,
  }
}

/**
 * 解析用户最终生效的限额规则。
 *
 * 没有 `user_quotas` 行的用户等价于「跟随默认策略 + 无覆写 + 未暂停」，
 * 因此新注册用户不需要任何写入就受默认策略约束。
 */
export async function getUserQuotaBinding(userId: string): Promise<UserQuotaBinding> {
  const [row] = await db.select().from(userQuotas).where(eq(userQuotas.userId, userId)).limit(1)
  const overrides = normalizeUserQuotaOverrides(row?.overrides)

  const [policyRow] = row?.policyId
    ? await db.select().from(quotaPolicies).where(eq(quotaPolicies.id, row.policyId)).limit(1)
    : await db.select().from(quotaPolicies).where(eq(quotaPolicies.isDefault, true)).limit(1)

  const policyRules = normalizeQuotaRules(policyRow?.rules)
  return {
    policyId: row?.policyId ?? null,
    policyName: policyRow?.name ?? null,
    usingDefaultPolicy: !row?.policyId,
    enforcementPaused: row?.enforcementPaused ?? false,
    pausedAt: row?.pausedAt?.getTime() ?? null,
    note: row?.note ?? null,
    overrides,
    rules: resolveEffectiveQuota(policyRules, overrides),
  }
}

/** 该用户当前可用的模型（与用户端模型列表口径逐字一致，避免桶里出现看不到的模型）。 */
async function listQuotaModels(userId: string): Promise<QuotaModelRow[]> {
  return db
    .select({ id: models.id, displayName: models.displayName, groupId: models.groupId })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .leftJoin(modelUserAccess, accessJoinForUser(userId))
    .where(and(eq(models.enabled, true), eq(providers.enabled, true), accessibleToUser()))
    .orderBy(models.sort, models.displayName)
}

async function listGroupNames(groupIds: string[]): Promise<Map<string, string>> {
  if (groupIds.length === 0) return new Map()
  const rows = await db
    .select({ id: modelGroups.id, name: modelGroups.name })
    .from(modelGroups)
    .where(inArray(modelGroups.id, groupIds))
  return new Map(rows.map((row) => [row.id, row.name]))
}

const modelKey = (modelId: string | null) => modelId ?? ''

/**
 * 聚合某统计起点之后的用量。
 *
 * - 成本按 `pricing_snapshot` 分组累加，与 `services/stats.ts` 完全同口径；
 * - 失败请求（`success=0`）既不计费也不计次，不消耗用户额度；
 * - 队列中/生成中的 run 补计入「请求次数」——`usage_logs` 要等 finalize 才写行，
 *   不补这一段的话并发连发能在计数追上之前突破次数上限。
 */
async function aggregateUsageSince(userId: string, startMs: number): Promise<UsageAggregate> {
  const conditions: SQL[] = [eq(usageLogs.userId, userId), eq(usageLogs.success, true)]
  if (startMs > 0) conditions.push(gte(usageLogs.createdAt, new Date(startMs)))

  const rows = await db
    .select({
      modelId: usageLogs.modelId,
      pricingSnapshot: usageLogs.pricingSnapshot,
      requests: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${usageLogs.inputTokens}),0)`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usageLogs.cacheWriteTokens}),0)`,
      cachedTokens: sql<number>`coalesce(sum(${usageLogs.cachedTokens}),0)`,
      outputTokens: sql<number>`coalesce(sum(${usageLogs.outputTokens}),0)`,
      imageTokens: sql<number>`coalesce(sum(${usageLogs.imageTokens}),0)`,
    })
    .from(usageLogs)
    .where(and(...conditions))
    .groupBy(usageLogs.modelId, usageLogs.pricingSnapshot)

  const aggregate: UsageAggregate = {
    totalRequests: 0,
    totalCost: 0,
    requestsByModel: new Map(),
    costByModel: new Map(),
  }
  const add = (map: Map<string, number>, key: string, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value)

  for (const row of rows) {
    const cost = costUsd(row, row.pricingSnapshot as ModelPricing | null)
    const key = modelKey(row.modelId)
    aggregate.totalRequests += row.requests
    aggregate.totalCost += cost
    add(aggregate.requestsByModel, key, row.requests)
    add(aggregate.costByModel, key, cost)
  }

  const pendingConditions: SQL[] = [
    eq(runs.userId, userId),
    inArray(runs.state, [...PENDING_RUN_STATES]),
  ]
  if (startMs > 0) pendingConditions.push(gte(runs.createdAt, new Date(startMs)))
  const pending = await db
    .select({ modelId: runs.modelId, requests: sql<number>`count(*)` })
    .from(runs)
    .where(and(...pendingConditions))
    .groupBy(runs.modelId)
  for (const row of pending) {
    aggregate.totalRequests += row.requests
    add(aggregate.requestsByModel, modelKey(row.modelId), row.requests)
  }

  return aggregate
}

function sumUsage(
  aggregate: UsageAggregate,
  modelIds: string[] | null,
  metric: QuotaMetric,
): number {
  const byModel = metric === 'cost' ? aggregate.costByModel : aggregate.requestsByModel
  if (!modelIds) return metric === 'cost' ? aggregate.totalCost : aggregate.totalRequests
  return modelIds.reduce((sum, id) => sum + (byModel.get(id) ?? 0), 0)
}

/** 调整记录的作用目标：桶的规则 id、桶 key 与当前周期起点。 */
interface AdjustmentTarget {
  ruleId: string
  bucketKey: string | null
  periodStart: number
}

const targetOfBucket = (bucket: QuotaBucket): AdjustmentTarget => ({
  ruleId: bucket.rule.id,
  bucketKey: bucket.bucketKey,
  periodStart: bucket.periodStart,
})

/**
 * 调整记录（临时额度 / 手动重置）是否作用于某个桶的当前周期。
 *
 * 周期判据是「生效时刻不早于统计窗口起点」，对三种窗口统一成立：日历周期下，上一周期
 * 的记录自然落在本周期 `periodStart` 之前；滚动窗口的 `periodStart` 每毫秒前移，
 * `effectiveFrom >= now - 窗口长度` 恰好等价于「记录还在窗口内」——**不能**改用
 * `periodStart` 相等匹配，那样滚动窗口的赠送与重置写完下一次查询就会失效；
 * `total` 窗口 `periodStart = 0`，记录终身有效。
 *
 * 目标判据：`ruleId=null` 作用于该用户全部规则；桶级绑定按 kind 区分——
 * - `reset` 的 `bucketKey=null` 表示「该规则的所有桶」，否则「重置全部」碰不到各自独立的桶；
 * - `grant` 的 `bucketKey=null` 只匹配单桶规则，否则一份赠送会被每个桶重复享用。
 */
function adjustmentApplies(row: QuotaAdjustmentRow, target: AdjustmentTarget): boolean {
  if (row.effectiveFrom < target.periodStart) return false
  if (row.ruleId === null) return true
  if (row.ruleId !== target.ruleId) return false
  if (row.bucketKey === null) return row.kind === 'reset' || target.bucketKey === null
  return row.bucketKey === target.bucketKey
}

/** 某条调整记录当前是否仍生效（管理端列表用）：未过期且命中任一当前桶。 */
export function isQuotaAdjustmentActive(
  row: QuotaAdjustmentRow,
  buckets: QuotaBucketUsageDTO[],
  now: number,
): boolean {
  if (row.expiresAt !== null && row.expiresAt <= now) return false
  return buckets.some((bucket) => adjustmentApplies(row, bucket))
}

interface BucketContext {
  modelsById: Map<string, QuotaModelRow>
  modelsByGroup: Map<string, string[]>
  groupNames: Map<string, string>
  period: { startMs: number; endMs: number | null }
  /** 该模型是否已被更高优先级规则接管：对本条规则既不计量也不拦截 */
  isShadowed: (modelId: string) => boolean
}

/** 规则命中的模型集合（分组按 `models.group_id` 当前值实时判定，与展开逻辑同口径）。 */
function ruleTargetModelIds(rule: EffectiveQuotaRule, context: BucketContext): string[] {
  if (rule.scope.type === 'all') return [...context.modelsById.keys()]
  if (rule.scope.type === 'models') {
    return rule.scope.modelIds.filter((id) => context.modelsById.has(id))
  }
  return rule.scope.groupIds.flatMap((id) => context.modelsByGroup.get(id) ?? [])
}

/**
 * 优先级遮蔽表：模型 → 命中它的规则中的最高优先级。
 *
 * 判定时只保留优先级等于该值的规则，因此「OpenAI 分组限额 + 组内某个模型豁免（更高优先级）」
 * 不需要枚举组内其他模型，新模型进组也会自动落入分组规则。规则全为默认档 0 时该表不产生任何影响。
 */
function resolveTopPriorityByModel(
  rules: EffectiveQuotaRule[],
  context: BucketContext,
): Map<string, number> {
  const top = new Map<string, number>()
  for (const rule of rules) {
    for (const modelId of ruleTargetModelIds(rule, context)) {
      top.set(modelId, Math.max(top.get(modelId) ?? 0, rule.priority))
    }
  }
  return top
}

/** 展开某条规则的额度桶。「各自独立」按目标逐个展开，其余为单桶。 */
function expandRuleBuckets(rule: EffectiveQuotaRule, context: BucketContext): QuotaBucket[] {
  const base = {
    rule,
    periodStart: context.period.startMs,
    periodEnd: context.period.endMs,
    usageStart: context.period.startMs,
    invalid: false,
    shadowed: false,
  }
  const keep = (ids: string[]) => ids.filter((id) => !context.isShadowed(id))

  if (rule.scope.type === 'all') {
    const all = [...context.modelsById.keys()]
    const visible = keep(all)
    // 没有任何模型被遮蔽时保持 null（=「全部用量」），已删除模型留下的历史用量仍计入这条规则；
    // 一旦出现遮蔽就必须退化成显式模型列表，代价是无法归属到模型的历史用量不再计入。
    if (visible.length === all.length) {
      return [{ ...base, bucketKey: null, bucketLabel: null, modelIds: null }]
    }
    return [
      {
        ...base,
        bucketKey: null,
        bucketLabel: null,
        modelIds: visible,
        shadowed: visible.length === 0,
      },
    ]
  }

  // 目标全部被删除/下架时保留一个「失效」占位桶：既不参与拦截（宁可放行也不误拦），
  // 又能让管理端看到这条规则已经指向不存在的目标，而不是让它凭空消失。
  const invalidBucket = (): QuotaBucket[] => [
    { ...base, bucketKey: null, bucketLabel: null, modelIds: [], invalid: true },
  ]

  if (rule.scope.type === 'models') {
    const existing = rule.scope.modelIds.filter((id) => context.modelsById.has(id))
    if (existing.length === 0) return invalidBucket()
    if (rule.scope.mode === 'shared') {
      const visible = keep(existing)
      return [
        {
          ...base,
          bucketKey: null,
          bucketLabel: null,
          modelIds: visible,
          shadowed: visible.length === 0,
        },
      ]
    }
    return existing.map((id) => {
      const shadowed = context.isShadowed(id)
      return {
        ...base,
        bucketKey: id,
        bucketLabel: context.modelsById.get(id)?.displayName ?? null,
        modelIds: shadowed ? [] : [id],
        shadowed,
      }
    })
  }

  const existingGroups = rule.scope.groupIds.filter((id) => context.groupNames.has(id))
  if (existingGroups.length === 0) return invalidBucket()
  if (rule.scope.mode === 'shared') {
    const members = existingGroups.flatMap((id) => context.modelsByGroup.get(id) ?? [])
    const visible = keep(members)
    return [
      {
        ...base,
        bucketKey: null,
        bucketLabel: null,
        modelIds: visible,
        shadowed: members.length > 0 && visible.length === 0,
      },
    ]
  }
  return existingGroups.map((id) => {
    const members = context.modelsByGroup.get(id) ?? []
    const visible = keep(members)
    return {
      ...base,
      bucketKey: id,
      bucketLabel: context.groupNames.get(id) ?? null,
      modelIds: visible,
      shadowed: members.length > 0 && visible.length === 0,
    }
  })
}

function toGrantDTO(row: QuotaAdjustmentRow): QuotaGrantDTO {
  return {
    id: row.id,
    ruleId: row.ruleId,
    bucketKey: row.bucketKey,
    metric: row.metric,
    amount: row.amount ?? 0,
    note: row.note,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    createdByName: row.createdByName,
  }
}

export interface QuotaSnapshot {
  config: QuotaConfig
  binding: UserQuotaBinding
  unlimited: boolean
  rules: QuotaBucketUsageDTO[]
  /**
   * 与 `rules` 一一对应的模型集合（null=全部模型）。留在服务层内部使用：
   * 拦截判定需要精确知道某条规则覆盖哪些模型，DTO 不适合暴露展开后的成员。
   */
  bucketModelIds: (string[] | null)[]
  /** 额度已用尽、当前不可用的模型；`enforcementPaused` 时为空（暂停期间不拦截） */
  blockedModelIds: string[]
}

export interface SnapshotOptions {
  now?: number
  config?: QuotaConfig
  /** 已解析好的绑定信息，避免重复查询 */
  binding?: UserQuotaBinding
  /** 用草稿规则替代库中规则（管理端「保存前预览」用） */
  rulesOverride?: EffectiveQuotaRule[]
  /** 预览时覆盖「是否暂停」，以呈现保存后的真实状态 */
  pausedOverride?: boolean
  adjustments?: QuotaAdjustmentRow[]
}

/** 读取某用户的全部周期调整记录（含已失效项，由调用方按当前周期过滤）。 */
export async function listQuotaAdjustments(userId: string): Promise<QuotaAdjustmentRow[]> {
  const rows = await db
    .select({
      id: quotaAdjustments.id,
      kind: quotaAdjustments.kind,
      ruleId: quotaAdjustments.ruleId,
      bucketKey: quotaAdjustments.bucketKey,
      metric: quotaAdjustments.metric,
      amount: quotaAdjustments.amount,
      effectiveFrom: quotaAdjustments.effectiveFrom,
      periodStart: quotaAdjustments.periodStart,
      expiresAt: quotaAdjustments.expiresAt,
      note: quotaAdjustments.note,
      createdAt: quotaAdjustments.createdAt,
      createdByName: users.username,
    })
    .from(quotaAdjustments)
    .leftJoin(users, eq(quotaAdjustments.createdBy, users.id))
    .where(eq(quotaAdjustments.userId, userId))
    .orderBy(desc(quotaAdjustments.createdAt))
  return rows.map((row) => ({
    ...row,
    effectiveFrom: row.effectiveFrom.getTime(),
    periodStart: row.periodStart.getTime(),
    expiresAt: row.expiresAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
  }))
}

/**
 * 计算某用户的完整额度快照（用户端进度条、管理端列表与拦截判定共用）。
 *
 * 用量全部从 `usage_logs` 派生，不维护计数器：策略/窗口/范围改动后立即按新口径重算，
 * 也永远不会出现「计数器与后台统计对不上」。
 */
export async function getQuotaSnapshot(
  userId: string,
  options: SnapshotOptions = {},
): Promise<QuotaSnapshot> {
  const now = options.now ?? Date.now()
  const config = options.config ?? (await getQuotaConfig())
  const binding = options.binding ?? (await getUserQuotaBinding(userId))
  const rules = options.rulesOverride ?? binding.rules
  const paused = options.pausedOverride ?? binding.enforcementPaused

  if (rules.length === 0) {
    return {
      config,
      binding,
      unlimited: true,
      rules: [],
      bucketModelIds: [],
      blockedModelIds: [],
    }
  }

  const modelRows = await listQuotaModels(userId)
  const modelsById = new Map(modelRows.map((row) => [row.id, row]))
  const modelsByGroup = new Map<string, string[]>()
  for (const row of modelRows) {
    if (!row.groupId) continue
    modelsByGroup.set(row.groupId, [...(modelsByGroup.get(row.groupId) ?? []), row.id])
  }
  const groupNames = await listGroupNames([
    ...new Set(rules.flatMap((rule) => (rule.scope.type === 'groups' ? rule.scope.groupIds : []))),
  ])
  const adjustments = options.adjustments ?? (await listQuotaAdjustments(userId))

  // 1) 展开桶，按优先级遮蔽剔除被更高优先级规则接管的模型，并按「手动重置」抬高统计起点
  const sharedContext = {
    modelsById,
    modelsByGroup,
    groupNames,
    period: { startMs: 0, endMs: null },
    isShadowed: () => false,
  }
  const topPriorityByModel = resolveTopPriorityByModel(rules, sharedContext)
  const buckets: QuotaBucket[] = []
  for (const rule of rules) {
    const period = resolveQuotaPeriod(rule.window, now, {
      timezone: config.quotaTimezone,
      weekStart: config.quotaWeekStart,
    })
    for (const bucket of expandRuleBuckets(rule, {
      ...sharedContext,
      period,
      isShadowed: (modelId) => (topPriorityByModel.get(modelId) ?? 0) > rule.priority,
    })) {
      const target = targetOfBucket(bucket)
      const latestReset = adjustments.reduce(
        (max, row) =>
          row.kind === 'reset' && adjustmentApplies(row, target)
            ? Math.max(max, row.effectiveFrom)
            : max,
        0,
      )
      // 聚合条件是 `created_at >= usageStart`，而重置语义是「重置时刻及之前的用量不再计入」，
      // 因此起点取重置时刻的下一毫秒；同毫秒内先写的用量日志不会侥幸留下。
      buckets.push({
        ...bucket,
        usageStart: Math.max(bucket.usageStart, latestReset > 0 ? latestReset + 1 : 0),
      })
    }
  }

  // 2) 按统计起点去重聚合：同一起点的所有桶共用一次查询
  const aggregates = new Map<number, UsageAggregate>()
  for (const start of new Set(buckets.map((bucket) => bucket.usageStart))) {
    aggregates.set(start, await aggregateUsageSince(userId, start))
  }

  // 3) 叠加当前周期内仍有效的临时额度并评估
  const usageRules: QuotaBucketUsageDTO[] = buckets.map((bucket) => {
    const aggregate = aggregates.get(bucket.usageStart)!
    const used =
      bucket.invalid || bucket.shadowed
        ? 0
        : sumUsage(aggregate, bucket.modelIds, bucket.rule.metric)
    const grantRows = adjustments.filter(
      (row) =>
        row.kind === 'grant' &&
        row.metric === bucket.rule.metric &&
        (row.expiresAt === null || row.expiresAt > now) &&
        adjustmentApplies(row, targetOfBucket(bucket)),
    )
    const granted = grantRows.reduce((sum, row) => sum + (row.amount ?? 0), 0)
    const evaluation = evaluateQuotaLimit({ limit: bucket.rule.limit, used, granted })
    return {
      ruleId: bucket.rule.id,
      bucketKey: bucket.bucketKey,
      bucketLabel: bucket.bucketLabel,
      label: bucket.rule.label,
      source: bucket.rule.source,
      scope: bucket.rule.scope,
      metric: bucket.rule.metric,
      window: bucket.rule.window,
      limit: bucket.rule.limit,
      priority: bucket.rule.priority,
      used: evaluation.used,
      granted: evaluation.granted,
      effectiveLimit: evaluation.effectiveLimit,
      remaining: evaluation.remaining,
      percent: evaluation.percent,
      // 失效规则（目标已不存在）与被更高优先级接管的桶永不拦截。
      blocked: bucket.invalid || bucket.shadowed ? false : evaluation.blocked,
      periodStart: bucket.periodStart,
      usageStart: bucket.usageStart,
      periodEnd: bucket.periodEnd,
      grants: grantRows.map(toGrantDTO),
      invalid: bucket.invalid,
      shadowed: bucket.shadowed,
    }
  })
  const bucketModelIds = buckets.map((bucket) => bucket.modelIds)

  // 4) 派生「哪些模型当前不可用」：per-model 规则耗尽只影响自己
  const blockedModelIds: string[] = []
  if (!paused) {
    for (const model of modelRows) {
      const blocked = usageRules.some(
        (rule, index) =>
          rule.blocked &&
          (bucketModelIds[index] === null || bucketModelIds[index]!.includes(model.id)),
      )
      if (blocked) blockedModelIds.push(model.id)
    }
  }

  return {
    config,
    binding,
    unlimited: isQuotaUnlimited(rules),
    rules: usageRules,
    bucketModelIds,
    blockedModelIds,
  }
}

/** 把最紧张的桶排在前：已耗尽 > 占比高 > 无限额度垫底，供列表与提示条取第一条。 */
export function sortQuotaBucketsBySeverity(rules: QuotaBucketUsageDTO[]): QuotaBucketUsageDTO[] {
  return [...rules].sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? -1 : 1
    return (b.percent ?? -1) - (a.percent ?? -1)
  })
}

/** 用户端视图：全局关闭时不返回任何额度数字。 */
export async function getMyQuota(userId: string): Promise<MyQuotaDTO> {
  const config = await getQuotaConfig()
  if (!config.quotaEnabled) {
    return {
      enabled: false,
      paused: false,
      unlimited: true,
      policyName: null,
      warnThreshold: config.quotaWarnThreshold,
      rules: [],
      blockedModelIds: [],
    }
  }
  const snapshot = await getQuotaSnapshot(userId, { config })
  return {
    enabled: true,
    paused: snapshot.binding.enforcementPaused,
    unlimited: snapshot.unlimited,
    policyName: snapshot.binding.policyName,
    warnThreshold: config.quotaWarnThreshold,
    rules: sortQuotaBucketsBySeverity(snapshot.rules),
    blockedModelIds: snapshot.blockedModelIds,
  }
}

/** 重置时刻的中文表述（按限额时区，保证管理员与用户看到同一个重置点）。 */
export function formatQuotaResetTime(periodEnd: number | null, timezone: string): string | null {
  if (periodEnd === null) return null
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      hour12: false,
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(periodEnd))
  } catch {
    return new Date(periodEnd).toISOString()
  }
}

/** 拦截文案：说清哪条限制、用了多少、什么时候恢复。 */
export function describeQuotaBlock(bucket: QuotaBucketUsageDTO, timezone: string): string {
  const target = bucket.bucketLabel ? `${bucket.bucketLabel} 的` : ''
  const metricLabel = bucket.metric === 'cost' ? '消费额度' : '请求次数'
  const used = formatQuotaAmount(bucket.metric, bucket.used)
  const limit = formatQuotaAmount(bucket.metric, bucket.effectiveLimit ?? 0)
  const reset = formatQuotaResetTime(bucket.periodEnd, timezone)
  const tail = reset
    ? `，将于 ${reset} 重置`
    : bucket.window.type === 'rolling'
      ? '，请稍后再试或联系管理员'
      : '，请联系管理员调整额度'
  return `${target}${describeQuotaWindow(bucket.window)}${metricLabel}已用尽（${used} / ${limit}）${tail}`
}

export type QuotaCheckResult =
  | { ok: true }
  | { ok: false; message: string; ruleId: string; bucketKey: string | null }

/**
 * 发起生成前的额度校验。两个有意的取舍：
 *
 * - 成本型额度只能事后计量（token 要等响应结束才知道），因此剩余额度极少时仍会放行一次请求、
 *   可能小幅超支；这是「不误拦」优先于「绝不超支」的选择。次数型额度靠在途 run 计数收敛。
 * - 「暂停限额」只跳过这里的判定，用量照常写入 `usage_logs`；恢复后立即按累计值重新判定，
 *   若期间已超支则恢复瞬间进入「已耗尽」。
 */
export async function checkQuota(userId: string, modelDbId: string): Promise<QuotaCheckResult> {
  const config = await getQuotaConfig()
  if (!config.quotaEnabled) return { ok: true }

  const binding = await getUserQuotaBinding(userId)
  if (binding.enforcementPaused) return { ok: true }
  if (isQuotaUnlimited(binding.rules)) return { ok: true }

  const snapshot = await getQuotaSnapshot(userId, { config, binding })
  if (!snapshot.blockedModelIds.includes(modelDbId)) return { ok: true }

  const blockingBuckets = snapshot.rules.filter((rule, index) => {
    if (!rule.blocked) return false
    const modelIds = snapshot.bucketModelIds[index] ?? null
    return modelIds === null || modelIds.includes(modelDbId)
  })
  const bucket = sortQuotaBucketsBySeverity(blockingBuckets)[0]
  if (!bucket) return { ok: true }
  return {
    ok: false,
    message: describeQuotaBlock(bucket, config.quotaTimezone),
    ruleId: bucket.ruleId,
    bucketKey: bucket.bucketKey,
  }
}
