import type {
  EffectiveQuotaRule,
  QuotaLimit,
  QuotaMetric,
  QuotaRule,
  QuotaRuleOverride,
  QuotaScope,
  QuotaWindow,
  UserQuotaOverrides,
} from '../types/domain'
import { QUOTA_HOURLY_WINDOW_MAX_HOURS, describeQuotaWindow } from './quotaWindow'

export const QUOTA_MAX_RULES_PER_POLICY = 12
export const QUOTA_MAX_SCOPE_TARGETS = 200
export const QUOTA_RULE_LABEL_MAX_LENGTH = 40
export const QUOTA_POLICY_NAME_MAX_LENGTH = 40
export const QUOTA_NOTE_MAX_LENGTH = 200
/** 规则优先级上限；0 为默认档，够用又不至于让管理员在几十个档位里迷路。 */
export const QUOTA_MAX_RULE_PRIORITY = 99
/** 两种按小时窗口在管理端共用的常见预设档位。 */
export const QUOTA_DURATION_PRESET_HOURS = [5, 24, 168, 720] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** 去重 + 裁剪目标 id 列表；空列表让规则整体失效（返回 null）。 */
function normalizeTargetIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || ids.includes(id)) continue
    if (ids.length >= QUOTA_MAX_SCOPE_TARGETS) break
    ids.push(id)
  }
  return ids.length > 0 ? ids : null
}

function normalizeScope(value: unknown): QuotaScope | null {
  if (!isRecord(value)) return null
  if (value.type === 'all') return { type: 'all' }
  const mode = value.mode === 'shared' ? 'shared' : 'each'
  if (value.type === 'models') {
    const modelIds = normalizeTargetIds(value.modelIds)
    return modelIds ? { type: 'models', modelIds, mode } : null
  }
  if (value.type === 'groups') {
    const groupIds = normalizeTargetIds(value.groupIds)
    return groupIds ? { type: 'groups', groupIds, mode } : null
  }
  return null
}

function normalizeWindow(value: unknown): QuotaWindow | null {
  if (!isRecord(value)) return null
  if (value.type === 'total') return { type: 'total' }
  if (value.type === 'rolling' || value.type === 'anchored') {
    if (!isPositiveNumber(value.hours)) return null
    const hours = Math.min(QUOTA_HOURLY_WINDOW_MAX_HOURS, Math.round(value.hours))
    return { type: value.type, hours }
  }
  if (value.type === 'calendar') {
    const period = value.period
    if (period !== 'day' && period !== 'week' && period !== 'month') return null
    return { type: 'calendar', period }
  }
  return null
}

function normalizeLimit(value: unknown): QuotaLimit | null {
  if (!isRecord(value)) return null
  if (value.kind === 'unlimited') return { kind: 'unlimited' }
  if (value.kind === 'amount' && isPositiveNumber(value.value)) {
    return { kind: 'amount', value: value.value }
  }
  return null
}

function normalizeMetric(value: unknown): QuotaMetric | null {
  return value === 'requests' || value === 'cost' ? value : null
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.trim().slice(0, QUOTA_RULE_LABEL_MAX_LENGTH)
  return label || null
}

/** 优先级归一化：缺失或非法一律回落 0（默认档），越界钳制，小数取整。 */
function normalizePriority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(QUOTA_MAX_RULE_PRIORITY, Math.round(value)))
}

/** 单条规则归一化；任何非法字段都让该条规则整体作废（宁可少一条限制也不能误拦）。 */
function normalizeQuotaRule(value: unknown): QuotaRule | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) return null
  const scope = normalizeScope(value.scope)
  const metric = normalizeMetric(value.metric)
  const limit = normalizeLimit(value.limit)
  const window = normalizeWindow(value.window)
  if (!scope || !metric || !limit || !window) return null
  return {
    id,
    label: normalizeLabel(value.label),
    scope,
    metric,
    limit,
    window,
    priority: normalizePriority(value.priority),
  }
}

/**
 * 把（可能来自旧版本、手工改库或脏 JSON 的）规则数组归一化为安全的 QuotaRule[]。
 *
 * 与 `normalizeModelTags` / `normalizeModelIcon` 同一契约：入参 `unknown`、绝不抛错、
 * 非法项静默丢弃。丢弃方向刻意选择「放行」而不是「拦截」——一条读不懂的规则
 * 不该把用户挡在门外。
 */
export function normalizeQuotaRules(value: unknown): QuotaRule[] {
  if (!Array.isArray(value)) return []
  const rules: QuotaRule[] = []
  const seenIds = new Set<string>()
  for (const item of value) {
    const rule = normalizeQuotaRule(item)
    if (!rule || seenIds.has(rule.id)) continue
    if (rules.length >= QUOTA_MAX_RULES_PER_POLICY) break
    rules.push(rule)
    seenIds.add(rule.id)
  }
  return rules
}

function normalizeRuleOverride(value: unknown): QuotaRuleOverride | null {
  if (!isRecord(value)) return null
  const override: QuotaRuleOverride = {}
  const limit = normalizeLimit(value.limit)
  if (limit) override.limit = limit
  const window = normalizeWindow(value.window)
  if (window) override.window = window
  if (value.disabled === true) override.disabled = true
  return Object.keys(override).length > 0 ? override : null
}

/** 覆写归一化：未知规则 id 也保留（策略可能稍后加回该规则），非法内容丢弃。 */
export function normalizeUserQuotaOverrides(value: unknown): UserQuotaOverrides {
  if (!isRecord(value)) return {}
  const overrides: UserQuotaOverrides = {}
  if (isRecord(value.rules)) {
    const rules: Record<string, QuotaRuleOverride> = {}
    for (const [ruleId, raw] of Object.entries(value.rules)) {
      const id = ruleId.trim()
      if (!id) continue
      const override = normalizeRuleOverride(raw)
      if (override) rules[id] = override
    }
    if (Object.keys(rules).length > 0) overrides.rules = rules
  }
  const extraRules = normalizeQuotaRules(value.extraRules)
  if (extraRules.length > 0) overrides.extraRules = extraRules
  return overrides
}

/**
 * 策略规则 + 用户覆写 → 最终生效规则。
 *
 * 覆写只改 limit / window（范围与计量属于模板语义，要改就该新建规则或用专属规则），
 * `disabled` 直接移除该条继承规则。用户专属规则排在继承规则之后。
 */
export function resolveEffectiveQuota(
  policyRules: QuotaRule[],
  overrides: UserQuotaOverrides | null | undefined,
): EffectiveQuotaRule[] {
  const ruleOverrides = overrides?.rules ?? {}
  const resolved: EffectiveQuotaRule[] = []
  for (const rule of policyRules) {
    const override = ruleOverrides[rule.id]
    if (override?.disabled) continue
    const changed = Boolean(override?.limit || override?.window)
    resolved.push({
      ...rule,
      limit: override?.limit ?? rule.limit,
      window: override?.window ?? rule.window,
      source: changed ? 'override' : 'policy',
    })
  }
  const policyRuleIds = new Set(policyRules.map((rule) => rule.id))
  for (const rule of overrides?.extraRules ?? []) {
    // 与继承规则 id 冲突的专属规则丢弃，避免覆写与专属规则指向同一个 id。
    if (policyRuleIds.has(rule.id)) continue
    resolved.push({ ...rule, source: 'user' })
  }
  return resolved
}

/** 是否完全不限额：没有任何规则，或全部规则都是「无限」。 */
export function isQuotaUnlimited(rules: Pick<QuotaRule, 'limit'>[]): boolean {
  return rules.every((rule) => rule.limit.kind === 'unlimited')
}

export interface QuotaEvaluation {
  /** 本周期基础上限；null=无限额度 */
  baseLimit: number | null
  /** 临时赠送额度合计 */
  granted: number
  /** 基础 + 赠送后的最终上限；null=无限额度 */
  effectiveLimit: number | null
  used: number
  /** 剩余额度（不小于 0）；null=无限额度 */
  remaining: number | null
  /** 已用占比（可能 >1：暂停限额或单次超支）；null=无限额度 */
  percent: number | null
  blocked: boolean
}

/** 上限 + 赠送 + 已用 → 展示与判定所需的全部派生值。前后端共用，避免两处算错。 */
export function evaluateQuotaLimit(args: {
  limit: QuotaLimit
  used: number
  granted?: number
}): QuotaEvaluation {
  const used = Math.max(0, args.used)
  const granted = Math.max(0, args.granted ?? 0)
  if (args.limit.kind === 'unlimited') {
    return {
      baseLimit: null,
      granted,
      effectiveLimit: null,
      used,
      remaining: null,
      percent: null,
      blocked: false,
    }
  }
  const baseLimit = Math.max(0, args.limit.value)
  const effectiveLimit = baseLimit + granted
  return {
    baseLimit,
    granted,
    effectiveLimit,
    used,
    remaining: Math.max(0, effectiveLimit - used),
    percent: effectiveLimit > 0 ? used / effectiveLimit : 1,
    blocked: used >= effectiveLimit,
  }
}

/** 金额显示比聊天消息成本更精确：额度是钱，$0.5 不该显示成 `<$0.01` 之外的模糊值。 */
export function formatQuotaCostUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0'
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

/** 按计量口径格式化一个数量（成本→美元，次数→「300 次」）。 */
export function formatQuotaAmount(metric: QuotaMetric, value: number): string {
  return metric === 'cost' ? formatQuotaCostUsd(value) : `${Math.round(value)} 次`
}

/** 上限文案；豁免显式显示为「豁免（不限额）」而不是一个大数字。 */
export function formatQuotaLimit(metric: QuotaMetric, limit: QuotaLimit): string {
  return limit.kind === 'unlimited' ? '豁免（不限额）' : formatQuotaAmount(metric, limit.value)
}

export const QUOTA_METRIC_LABELS: Record<QuotaMetric, string> = {
  requests: '请求次数',
  cost: '消费金额',
}

export interface QuotaScopeNames {
  /** 模型 DB id → 显示名 */
  models?: Record<string, string>
  /** 分组 id → 名称 */
  groups?: Record<string, string>
}

/** 范围文案：「全部模型」/「GPT-5.5 等 3 个模型各自」/「Claude 分组共享」。 */
export function describeQuotaScope(scope: QuotaScope, names?: QuotaScopeNames): string {
  if (scope.type === 'all') return '全部模型'
  const ids = scope.type === 'models' ? scope.modelIds : scope.groupIds
  const lookup = scope.type === 'models' ? names?.models : names?.groups
  const noun = scope.type === 'models' ? '模型' : '分组'
  const suffix = scope.mode === 'each' ? '各自独立' : '共享额度'
  const first = lookup?.[ids[0] ?? ''] ?? (scope.type === 'models' ? '未知模型' : '未知分组')
  const head = ids.length === 1 ? first : `${first} 等 ${ids.length} 个${noun}`
  return `${head}·${suffix}`
}

/** 规则的一行中文摘要，如「每月 · 全部模型 · $30」；优先级非默认档时前置「优先 N」。 */
export function describeQuotaRule(
  rule: Pick<QuotaRule, 'scope' | 'metric' | 'limit' | 'window'> &
    Partial<Pick<QuotaRule, 'priority'>>,
  names?: QuotaScopeNames,
): string {
  return [
    ...(rule.priority ? [`优先 ${rule.priority}`] : []),
    describeQuotaWindow(rule.window),
    describeQuotaScope(rule.scope, names),
    formatQuotaLimit(rule.metric, rule.limit),
  ].join(' · ')
}

/**
 * 这条规则是否「什么都不做」：优先级为默认档 0 的豁免规则。
 *
 * 豁免只有在优先级高于其它命中同一模型的规则时才有意义（把该模型从大范围规则里放行）；
 * 同档内不发生遮蔽，因此 0 档豁免与不写这条规则完全等价，编辑器据此给出提示。
 */
export function isQuotaRuleNoOp(rule: Pick<QuotaRule, 'limit' | 'priority'>): boolean {
  return rule.limit.kind === 'unlimited' && rule.priority === 0
}

/** 「各自独立」的规则必须把临时额度/重置绑定到具体目标，否则一份赠送会被每个桶重复享用。 */
export function quotaRuleRequiresBucketKey(rule: Pick<QuotaRule, 'scope'>): boolean {
  return rule.scope.type !== 'all' && rule.scope.mode === 'each'
}
