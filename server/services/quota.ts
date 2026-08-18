import { and, desc, eq, gte, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
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
  sortQuotaBucketsBySeverity,
} from '@shared/util/quota'
import { HOUR_MS, describeQuotaWindow, resolveQuotaPeriod } from '@shared/util/quotaWindow'
import { db } from '../db/client'
import type { DB } from '../db/client'
import {
  modelGroups,
  modelUserAccess,
  models,
  providers,
  quotaAdjustments,
  quotaCycles,
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
  periodActive: boolean
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

interface QuotaCycleRow {
  ruleId: string
  bucketKey: string
  windowHours: number
  startedAt: number
  endsAt: number
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
const storedBucketKey = (bucketKey: string | null) => bucketKey ?? ''
const cycleMapKey = (ruleId: string, bucketKey: string | null) =>
  JSON.stringify([ruleId, storedBucketKey(bucketKey)])

async function listQuotaCycles(userId: string, ruleIds: string[]): Promise<QuotaCycleRow[]> {
  if (ruleIds.length === 0) return []
  const rows = await db
    .select({
      ruleId: quotaCycles.ruleId,
      bucketKey: quotaCycles.bucketKey,
      windowHours: quotaCycles.windowHours,
      startedAt: quotaCycles.startedAt,
      endsAt: quotaCycles.endsAt,
    })
    .from(quotaCycles)
    .where(and(eq(quotaCycles.userId, userId), inArray(quotaCycles.ruleId, ruleIds)))
  return rows.map((row) => ({
    ...row,
    startedAt: row.startedAt.getTime(),
    endsAt: row.endsAt.getTime(),
  }))
}

/**
 * 聚合某统计起点之后的用量。
 *
 * - 成本按 `pricing_snapshot` 分组累加，与 `services/stats.ts` 完全同口径；
 * - 只统计用户对话/生图的 `kind='chat'`；标题总结保留审计与成本日志，但永不占用户额度；
 * - 失败请求（`success=0`）既不计费也不计次，不消耗用户额度；
 * - 队列中/生成中的 run 补计入「请求次数」——`usage_logs` 要等 finalize 才写行，
 *   不补这一段的话并发连发能在计数追上之前突破次数上限。
 */
async function aggregateUsageSince(userId: string, startMs: number): Promise<UsageAggregate> {
  const conditions: SQL[] = [
    eq(usageLogs.userId, userId),
    eq(usageLogs.kind, 'chat'),
    eq(usageLogs.success, true),
  ]
  if (startMs > 0) {
    // 用量日志要等响应结束才写入；限额归属必须固定在请求获准时刻，否则跨周期完成的长请求
    // 会被算进下一个周期。迁移前的旧行没有 quota_at，安全回退 created_at。
    conditions.push(
      or(
        gte(usageLogs.quotaAt, new Date(startMs)),
        and(isNull(usageLogs.quotaAt), gte(usageLogs.createdAt, new Date(startMs))),
      )!,
    )
  }

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
 * 周期判据是「生效时刻不早于统计窗口起点」，对各类活动窗口统一成立：日历周期下，上一周期
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
  return buckets.some((bucket) => bucket.periodActive && adjustmentApplies(row, bucket))
}

interface BucketContext {
  modelsById: Map<string, QuotaModelRow>
  modelsByGroup: Map<string, string[]>
  groupNames: Map<string, string>
  period: { startMs: number; endMs: number | null; active: boolean }
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
    periodActive: context.period.active,
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

/**
 * 共享池与「全部模型被部分接管」列出实际还覆盖哪些模型。
 * 各自独立桶用 bucketLabel；仍覆盖全部可用模型时不必枚举。
 */
function targetLabelsOf(bucket: QuotaBucket, context: BucketContext): string[] | null {
  if (bucket.bucketKey !== null || bucket.modelIds === null) return null
  return bucket.modelIds.flatMap((id) => {
    const name = context.modelsById.get(id)?.displayName
    return name ? [name] : []
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
  /** 优先级遮蔽与失效目标解析后，是否没有实际覆盖模型的有限额度桶 */
  unlimited: boolean
  rules: QuotaBucketUsageDTO[]
  /** 额度已用尽、当前不可用的模型；`enforcementPaused` 时为空（暂停期间不拦截） */
  blockedModelIds: string[]
  /** 当前限额是否阻塞该用户可用的全部模型；没有可用模型时为 false */
  allModelsBlocked: boolean
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
      blockedModelIds: [],
      allModelsBlocked: false,
    }
  }

  const groupIds = [
    ...new Set(rules.flatMap((rule) => (rule.scope.type === 'groups' ? rule.scope.groupIds : []))),
  ]
  const anchoredRuleIds = rules
    .filter((rule) => rule.window.type === 'anchored')
    .map((rule) => rule.id)
  const [modelRows, groupNames, adjustments, cycleRows] = await Promise.all([
    listQuotaModels(userId),
    listGroupNames(groupIds),
    options.adjustments ?? listQuotaAdjustments(userId),
    listQuotaCycles(userId, anchoredRuleIds),
  ])
  const modelsById = new Map(modelRows.map((row) => [row.id, row]))
  const modelsByGroup = new Map<string, string[]>()
  for (const row of modelRows) {
    if (!row.groupId) continue
    modelsByGroup.set(row.groupId, [...(modelsByGroup.get(row.groupId) ?? []), row.id])
  }
  const cycleByBucket = new Map(
    cycleRows.map((cycle) => [
      cycleMapKey(cycle.ruleId, cycle.bucketKey === '' ? null : cycle.bucketKey),
      cycle,
    ]),
  )

  // 1) 展开桶，按优先级遮蔽剔除被更高优先级规则接管的模型，并按「手动重置」抬高统计起点
  const sharedContext = {
    modelsById,
    modelsByGroup,
    groupNames,
    period: { startMs: 0, endMs: null, active: true },
    isShadowed: () => false,
  }
  const topPriorityByModel = resolveTopPriorityByModel(rules, sharedContext)
  const buckets: QuotaBucket[] = []
  for (const rule of rules) {
    const basePeriod = resolveQuotaPeriod(rule.window, now, {
      timezone: config.quotaTimezone,
      weekStart: config.quotaWeekStart,
    })
    for (const expandedBucket of expandRuleBuckets(rule, {
      ...sharedContext,
      period: basePeriod,
      isShadowed: (modelId) => (topPriorityByModel.get(modelId) ?? 0) > rule.priority,
    })) {
      const cycle =
        rule.window.type === 'anchored'
          ? cycleByBucket.get(cycleMapKey(rule.id, expandedBucket.bucketKey))
          : undefined
      const period =
        rule.window.type === 'anchored'
          ? resolveQuotaPeriod(rule.window, now, {
              timezone: config.quotaTimezone,
              weekStart: config.quotaWeekStart,
              anchoredStartMs:
                cycle?.windowHours === rule.window.hours && cycle.endsAt > now
                  ? cycle.startedAt
                  : null,
            })
          : basePeriod
      const bucket: QuotaBucket = {
        ...expandedBucket,
        periodStart: period.startMs,
        periodEnd: period.endMs,
        periodActive: period.active,
        usageStart: period.startMs,
      }
      const target = targetOfBucket(bucket)
      const latestReset = bucket.periodActive
        ? adjustments.reduce(
            (max, row) =>
              row.kind === 'reset' &&
              (row.expiresAt === null || row.expiresAt > now) &&
              adjustmentApplies(row, target)
                ? Math.max(max, row.effectiveFrom)
                : max,
            0,
          )
        : 0
      // 聚合条件是 `quota_at >= usageStart`，而重置语义是「重置时刻及之前的用量不再计入」，
      // 因此起点取重置时刻的下一毫秒；同毫秒内先写的用量日志不会侥幸留下。
      buckets.push({
        ...bucket,
        usageStart: Math.max(bucket.usageStart, latestReset > 0 ? latestReset + 1 : 0),
      })
    }
  }

  // 2) 按统计起点去重聚合：同一起点的所有桶共用一次查询
  const aggregates = new Map<number, UsageAggregate>()
  for (const start of new Set(
    buckets.filter((bucket) => bucket.periodActive).map((bucket) => bucket.usageStart),
  )) {
    aggregates.set(start, await aggregateUsageSince(userId, start))
  }

  // 3) 叠加当前周期内仍有效的临时额度并评估
  const usageRules: QuotaBucketUsageDTO[] = buckets.map((bucket) => {
    const aggregate = bucket.periodActive ? aggregates.get(bucket.usageStart)! : null
    const used =
      !bucket.periodActive || bucket.invalid || bucket.shadowed
        ? 0
        : sumUsage(aggregate!, bucket.modelIds, bucket.rule.metric)
    const grantRows = bucket.periodActive
      ? adjustments.filter(
          (row) =>
            row.kind === 'grant' &&
            row.metric === bucket.rule.metric &&
            (row.expiresAt === null || row.expiresAt > now) &&
            adjustmentApplies(row, targetOfBucket(bucket)),
        )
      : []
    const granted = grantRows.reduce((sum, row) => sum + (row.amount ?? 0), 0)
    const evaluation = evaluateQuotaLimit({ limit: bucket.rule.limit, used, granted })
    return {
      ruleId: bucket.rule.id,
      bucketKey: bucket.bucketKey,
      bucketLabel: bucket.bucketLabel,
      targetLabels: targetLabelsOf(bucket, sharedContext),
      effectiveModelIds: bucket.modelIds,
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
      blocked:
        !bucket.periodActive || bucket.invalid || bucket.shadowed ? false : evaluation.blocked,
      periodActive: bucket.periodActive,
      periodStart: bucket.periodStart,
      usageStart: bucket.usageStart,
      periodEnd: bucket.periodEnd,
      grants: grantRows.map(toGrantDTO),
      invalid: bucket.invalid,
      shadowed: bucket.shadowed,
    }
  })
  // 4) 派生「哪些模型当前不可用」：per-model 规则耗尽只影响自己
  const blockedModelIds: string[] = []
  if (!paused) {
    for (const model of modelRows) {
      const blocked = usageRules.some(
        (rule) =>
          rule.blocked &&
          (rule.effectiveModelIds === null || rule.effectiveModelIds.includes(model.id)),
      )
      if (blocked) blockedModelIds.push(model.id)
    }
  }

  // 只有仍实际覆盖至少一个模型的有限桶才表示账号受限；被高优先级规则完全接管的旧桶
  // 继续留在管理端用于解释配置，但不应让用户端误以为账号存在额度上限。
  const unlimited = buckets.every(
    (bucket) =>
      bucket.rule.limit.kind === 'unlimited' ||
      bucket.invalid ||
      bucket.shadowed ||
      (bucket.modelIds !== null && bucket.modelIds.length === 0),
  )
  const allModelsBlocked = modelRows.length > 0 && blockedModelIds.length === modelRows.length

  return {
    config,
    binding,
    unlimited,
    rules: usageRules,
    blockedModelIds,
    allModelsBlocked,
  }
}

/** 用户端视图：全局关闭时不返回任何额度数字。 */
export async function getMyQuota(userId: string): Promise<MyQuotaDTO> {
  const config = await getQuotaConfig()
  if (!config.quotaEnabled) {
    return {
      enabled: false,
      paused: false,
      unlimited: true,
      allModelsBlocked: false,
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
    allModelsBlocked: snapshot.allModelsBlocked,
    policyName: snapshot.binding.policyName,
    warnThreshold: config.quotaWarnThreshold,
    // 用户只看实际生效的额度；完全被接管的桶仍留在管理快照中解释配置。
    // 顺序与策略 / 专属规则的展示顺序一致，不再按紧张程度重排。
    rules: snapshot.rules.filter((rule) => !rule.shadowed),
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

/** 一次获准请求需要确保已启动的首次请求周期；由读取阶段计算，在写事务中应用。 */
export interface QuotaCycleClaim {
  ruleId: string
  bucketKey: string | null
  windowHours: number
}

export interface PreparedQuotaAdmission {
  check: QuotaCheckResult
  cycleClaims: QuotaCycleClaim[]
}

type QuotaTransaction = Parameters<Parameters<DB['transaction']>[0]>[0]

/**
 * 在调用方的 IMMEDIATE 写事务内原子确保周期锚点存在。
 *
 * 相同用户/规则/桶由复合主键串行化：并发通过前置校验的请求会共享首个请求的锚点；
 * 已过期周期则由首个拿到写锁的请求开启下一周期。
 */
export function activateQuotaCyclesInTransaction(
  tx: QuotaTransaction,
  userId: string,
  claims: QuotaCycleClaim[],
  requestAt: Date,
): void {
  for (const claim of claims) {
    const bucketKey = storedBucketKey(claim.bucketKey)
    const existing = tx
      .select({ windowHours: quotaCycles.windowHours, endsAt: quotaCycles.endsAt })
      .from(quotaCycles)
      .where(
        and(
          eq(quotaCycles.userId, userId),
          eq(quotaCycles.ruleId, claim.ruleId),
          eq(quotaCycles.bucketKey, bucketKey),
        ),
      )
      .get()
    if (
      existing?.windowHours === claim.windowHours &&
      existing.endsAt.getTime() > requestAt.getTime()
    ) {
      continue
    }

    const endsAt = new Date(requestAt.getTime() + claim.windowHours * HOUR_MS)
    tx.insert(quotaCycles)
      .values({
        userId,
        ruleId: claim.ruleId,
        bucketKey,
        windowHours: claim.windowHours,
        startedAt: requestAt,
        endsAt,
        updatedAt: requestAt,
      })
      .onConflictDoUpdate({
        target: [quotaCycles.userId, quotaCycles.ruleId, quotaCycles.bucketKey],
        set: { windowHours: claim.windowHours, startedAt: requestAt, endsAt, updatedAt: requestAt },
      })
      .run()
  }
}

/** 没有其他业务写入可同事务提交时使用（目前仅供管理动作与服务层测试复用）。 */
export function activateQuotaCycles(
  userId: string,
  claims: QuotaCycleClaim[],
  requestAt: Date,
): void {
  if (claims.length === 0) return
  db.transaction((tx) => activateQuotaCyclesInTransaction(tx, userId, claims, requestAt), {
    behavior: 'immediate',
  })
}

/**
 * 管理员手动重置首次请求周期：删除锚点，回到未启动。
 *
 * `bucketKey=null` 表示该规则的全部桶（「重置全部」或单桶规则），否则只清指定桶。
 */
export function clearQuotaCyclesInTransaction(
  tx: QuotaTransaction,
  userId: string,
  targets: Array<{ ruleId: string; bucketKey: string | null }>,
): void {
  for (const target of targets) {
    tx.delete(quotaCycles)
      .where(
        and(
          eq(quotaCycles.userId, userId),
          eq(quotaCycles.ruleId, target.ruleId),
          ...(target.bucketKey !== null
            ? [eq(quotaCycles.bucketKey, storedBucketKey(target.bucketKey))]
            : []),
        ),
      )
      .run()
  }
}

function cycleClaimsForModel(snapshot: QuotaSnapshot, modelDbId: string): QuotaCycleClaim[] {
  const claims: QuotaCycleClaim[] = []
  snapshot.rules.forEach((rule) => {
    if (
      rule.window.type !== 'anchored' ||
      rule.limit.kind !== 'amount' ||
      rule.invalid ||
      rule.shadowed
    ) {
      return
    }
    const modelIds = rule.effectiveModelIds
    if (modelIds !== null && !modelIds.includes(modelDbId)) return
    claims.push({ ruleId: rule.ruleId, bucketKey: rule.bucketKey, windowHours: rule.window.hours })
  })
  return claims
}

/**
 * 发起生成前同时准备「是否放行」与固定周期声明。两个有意的取舍：
 *
 * - 成本型额度只能事后计量（token 要等响应结束才知道），因此剩余额度极少时仍会放行一次请求、
 *   可能小幅超支；这是「不误拦」优先于「绝不超支」的选择。次数型额度靠在途 run 计数收敛。
 * - 「暂停限额」只跳过这里的判定，用量照常写入 `usage_logs`；恢复后立即按累计值重新判定，
 *   若期间已超支则恢复瞬间进入「已耗尽」。
 * - 固定周期从首个获准请求开始；即使上游随后失败，周期仍已开始，但失败日志本身不消耗额度。
 */
export async function prepareQuotaAdmission(
  userId: string,
  modelDbId: string,
): Promise<PreparedQuotaAdmission> {
  const config = await getQuotaConfig()
  const binding = await getUserQuotaBinding(userId)
  const shouldEnforce =
    config.quotaEnabled && !binding.enforcementPaused && !isQuotaUnlimited(binding.rules)
  const needsCycleClaims = binding.rules.some(
    (rule) => rule.window.type === 'anchored' && rule.limit.kind === 'amount',
  )
  if (!shouldEnforce && !needsCycleClaims) return { check: { ok: true }, cycleClaims: [] }

  const snapshot = await getQuotaSnapshot(userId, { config, binding })
  const cycleClaims = cycleClaimsForModel(snapshot, modelDbId)
  if (!shouldEnforce || !snapshot.blockedModelIds.includes(modelDbId)) {
    return { check: { ok: true }, cycleClaims }
  }

  const blockingBuckets = snapshot.rules.filter((rule) => {
    if (!rule.blocked) return false
    const modelIds = rule.effectiveModelIds
    return modelIds === null || modelIds.includes(modelDbId)
  })
  const bucket = sortQuotaBucketsBySeverity(blockingBuckets)[0]
  if (!bucket) return { check: { ok: true }, cycleClaims }
  return {
    check: {
      ok: false,
      message: describeQuotaBlock(bucket, config.quotaTimezone),
      ruleId: bucket.ruleId,
      bucketKey: bucket.bucketKey,
    },
    cycleClaims: [],
  }
}

/** 兼容只需要判定、不创建 run 的调用方与测试。 */
export async function checkQuota(userId: string, modelDbId: string): Promise<QuotaCheckResult> {
  return (await prepareQuotaAdmission(userId, modelDbId)).check
}
