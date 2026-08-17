import type { QuotaMetric, QuotaRule } from '@shared/types/domain'
import {
  QUOTA_MAX_RULES_PER_POLICY,
  QUOTA_MAX_RULE_PRIORITY,
  formatQuotaAmount,
} from '@shared/util/quota'
import { QUOTA_HOURLY_WINDOW_MAX_HOURS, describeQuotaHours } from '@shared/util/quotaWindow'
import { createRandomUuid } from '../../lib/randomUuid'

export type QuotaScopeType = 'all' | 'models' | 'groups'
export type QuotaWindowChoice = 'day' | 'week' | 'month' | 'rolling' | 'anchored' | 'total'

/**
 * 规则编辑草稿：把联合类型摊平成表单字段，数值保留字符串形态
 * （输入过程中允许为空，不能直接塞进 number）。
 */
export interface QuotaRuleDraft {
  /** 稳定 id：编辑既有规则时必须原样保留，覆写与临时额度都绑定在它上面 */
  id: string
  label: string
  scopeType: QuotaScopeType
  /** 指定模型 / 分组时的目标 id */
  targetIds: string[]
  mode: 'each' | 'shared'
  metric: QuotaMetric
  unlimited: boolean
  limitInput: string
  windowChoice: QuotaWindowChoice
  durationHoursInput: string
  /** 优先级（字符串形态：输入过程中允许为空） */
  priorityInput: string
}

export const QUOTA_RULE_LIMIT = QUOTA_MAX_RULES_PER_POLICY

export function createQuotaRuleDraft(): QuotaRuleDraft {
  return {
    id: createRandomUuid(),
    label: '',
    scopeType: 'all',
    targetIds: [],
    mode: 'each',
    metric: 'cost',
    unlimited: false,
    limitInput: '',
    windowChoice: 'month',
    durationHoursInput: '5',
    priorityInput: '0',
  }
}

export function draftFromRule(rule: QuotaRule): QuotaRuleDraft {
  return {
    id: rule.id,
    label: rule.label ?? '',
    scopeType: rule.scope.type,
    targetIds:
      rule.scope.type === 'models'
        ? [...rule.scope.modelIds]
        : rule.scope.type === 'groups'
          ? [...rule.scope.groupIds]
          : [],
    mode: rule.scope.type === 'all' ? 'each' : rule.scope.mode,
    metric: rule.metric,
    unlimited: rule.limit.kind === 'unlimited',
    limitInput: rule.limit.kind === 'amount' ? String(rule.limit.value) : '',
    windowChoice:
      rule.window.type === 'calendar'
        ? rule.window.period
        : rule.window.type === 'rolling' || rule.window.type === 'anchored'
          ? rule.window.type
          : 'total',
    durationHoursInput:
      rule.window.type === 'rolling' || rule.window.type === 'anchored'
        ? String(rule.window.hours)
        : '5',
    priorityInput: String(rule.priority),
  }
}

export type DraftResult = { ok: true; rule: QuotaRule } | { ok: false; message: string }

/** 草稿 → 规则。错误文案直接面向管理员，说清缺了什么。 */
export function ruleFromDraft(draft: QuotaRuleDraft): DraftResult {
  if (draft.scopeType !== 'all' && draft.targetIds.length === 0) {
    return {
      ok: false,
      message: draft.scopeType === 'models' ? '请选择至少一个模型' : '请选择至少一个分组',
    }
  }

  const amount = Number(draft.limitInput)
  if (!draft.unlimited && (!draft.limitInput.trim() || !Number.isFinite(amount) || amount <= 0)) {
    return { ok: false, message: '请填写大于 0 的额度上限，或改为「不限」' }
  }
  if (!draft.unlimited && draft.metric === 'requests' && !Number.isInteger(amount)) {
    return { ok: false, message: '请求次数上限必须是整数' }
  }

  const hours = Number(draft.durationHoursInput)
  // 豁免不计量也不重置，隐藏的周期字段即使是非法小时也不能挡住保存。
  if (
    !draft.unlimited &&
    (draft.windowChoice === 'rolling' || draft.windowChoice === 'anchored') &&
    (!Number.isInteger(hours) || hours < 1 || hours > QUOTA_HOURLY_WINDOW_MAX_HOURS)
  ) {
    return {
      ok: false,
      message: `${draft.windowChoice === 'rolling' ? '滚动窗口' : '首次请求起算周期'}需为 1–${QUOTA_HOURLY_WINDOW_MAX_HOURS} 之间的整数小时`,
    }
  }

  const priority = draft.priorityInput.trim() === '' ? 0 : Number(draft.priorityInput)
  if (!Number.isInteger(priority) || priority < 0 || priority > QUOTA_MAX_RULE_PRIORITY) {
    return { ok: false, message: `优先级需为 0–${QUOTA_MAX_RULE_PRIORITY} 之间的整数` }
  }

  return {
    ok: true,
    rule: {
      id: draft.id,
      label: draft.label.trim() || null,
      scope:
        draft.scopeType === 'all'
          ? { type: 'all' }
          : draft.scopeType === 'models'
            ? { type: 'models', modelIds: draft.targetIds, mode: draft.mode }
            : { type: 'groups', groupIds: draft.targetIds, mode: draft.mode },
      metric: draft.metric,
      limit: draft.unlimited ? { kind: 'unlimited' } : { kind: 'amount', value: amount },
      window: windowFromDraft(draft, hours),
      priority,
    },
  }
}

export type DraftsResult =
  | { ok: true; rules: QuotaRule[] }
  | { ok: false; index: number; message: string }

/** 整批草稿 → 规则数组；第一条不合法的规则决定错误定位。 */
export function draftsToRules(drafts: QuotaRuleDraft[]): DraftsResult {
  const rules: QuotaRule[] = []
  for (const [index, draft] of drafts.entries()) {
    const result = ruleFromDraft(draft)
    if (!result.ok) return { ok: false, index, message: result.message }
    rules.push(result.rule)
  }
  return { ok: true, rules }
}

/** 折叠行右侧芯片用的短周期，避免「首次请求起算」把额度挤出视口。 */
const WINDOW_CHIP: Record<QuotaWindowChoice, string> = {
  day: '每天',
  week: '每周',
  month: '每月',
  rolling: '滚动',
  anchored: '起算',
  total: '永久',
}

export interface QuotaRuleDraftSummary {
  /** 折叠行主标题：有备注用备注，否则用范围短称 */
  title: string
  /** 范围 / 计量 / 独立或共享，供第二行扫读 */
  subtitle: string
  /** 右侧额度芯片：$30.00 / 300 次 / 豁免 / 未设上限 */
  limitText: string
  /** 右侧周期短称；豁免为空，调用方不要再拼「· 每月」 */
  windowText: string
  /** 大于 0 才展示「优先 N」；非法输入视为未设 */
  priority: number | null
  unlimited: boolean
  incomplete: boolean
}

function parseDraftPriority(input: string): number | null {
  const priority = input.trim() === '' ? 0 : Number(input)
  return Number.isInteger(priority) && priority >= 0 && priority <= QUOTA_MAX_RULE_PRIORITY
    ? priority
    : null
}

/** 草稿里的周期；豁免时只在合法时原样保留，非法小时改用永久占位以免写出坏数据。 */
function windowFromDraft(
  draft: QuotaRuleDraft,
  hours: number,
): QuotaRule['window'] {
  if (draft.windowChoice === 'rolling' || draft.windowChoice === 'anchored') {
    if (Number.isInteger(hours) && hours >= 1 && hours <= QUOTA_HOURLY_WINDOW_MAX_HOURS) {
      return { type: draft.windowChoice, hours }
    }
    return { type: 'total' }
  }
  return draft.windowChoice === 'total'
    ? { type: 'total' }
    : { type: 'calendar', period: draft.windowChoice }
}

function describeDraftWindow(draft: QuotaRuleDraft): string {
  if (draft.windowChoice !== 'rolling' && draft.windowChoice !== 'anchored') {
    return WINDOW_CHIP[draft.windowChoice]
  }
  const hours = Number(draft.durationHoursInput)
  if (!Number.isInteger(hours) || hours < 1) return WINDOW_CHIP[draft.windowChoice]
  return `${WINDOW_CHIP[draft.windowChoice]} ${describeQuotaHours(hours)}`
}

function describeDraftScope(draft: QuotaRuleDraft): string {
  if (draft.scopeType === 'all') return '全部模型'
  const noun = draft.scopeType === 'models' ? '模型' : '分组'
  if (draft.targetIds.length === 0) return draft.scopeType === 'models' ? '未选模型' : '未选分组'
  return `${draft.targetIds.length} 个${noun}`
}

function describeDraftLimit(draft: QuotaRuleDraft): { text: string; incomplete: boolean } {
  if (draft.unlimited) return { text: '豁免', incomplete: false }
  const amount = Number(draft.limitInput)
  if (!draft.limitInput.trim() || !Number.isFinite(amount) || amount <= 0) {
    return { text: '未设上限', incomplete: true }
  }
  if (draft.metric === 'requests' && !Number.isInteger(amount)) {
    return { text: '未设上限', incomplete: true }
  }
  return { text: formatQuotaAmount(draft.metric, amount), incomplete: false }
}

/**
 * 折叠行展示用的结构化摘要。不要求草稿已经能通过校验，
 * 好让管理员在填到一半时仍能扫读「这条规则大概是什么」。
 */
export function summarizeQuotaRuleDraft(draft: QuotaRuleDraft): QuotaRuleDraftSummary {
  const windowText = draft.unlimited ? '' : describeDraftWindow(draft)
  const scopeText = describeDraftScope(draft)
  const limit = describeDraftLimit(draft)
  const priority = parseDraftPriority(draft.priorityInput)
  const modeText =
    draft.scopeType === 'all' ? null : draft.mode === 'each' ? '各自独立' : '共享额度'
  const titled = Boolean(draft.label.trim())
  // 有备注时标题让给备注，第二行补回范围；没备注时标题就是范围，第二行不再重复。
  const subtitle = [
    titled ? scopeText : null,
    draft.metric === 'cost' ? '消费金额' : '请求次数',
    modeText,
  ]
    .filter(Boolean)
    .join(' · ')

  return {
    title: titled ? draft.label.trim() : scopeText,
    subtitle,
    limitText: limit.text,
    windowText,
    priority: priority && priority > 0 ? priority : null,
    unlimited: draft.unlimited,
    incomplete: limit.incomplete || (draft.scopeType !== 'all' && draft.targetIds.length === 0),
  }
}

/** 拖拽落点后重排；id 对不上时原样返回，避免半成品状态。 */
export function moveQuotaRuleDraft(
  drafts: QuotaRuleDraft[],
  fromId: string,
  toId: string,
): QuotaRuleDraft[] {
  if (fromId === toId) return drafts
  const from = drafts.findIndex((draft) => draft.id === fromId)
  const to = drafts.findIndex((draft) => draft.id === toId)
  if (from < 0 || to < 0) return drafts
  const next = [...drafts]
  const [moved] = next.splice(from, 1)
  if (!moved) return drafts
  next.splice(to, 0, moved)
  return next
}

/** 当前草稿里有几个不同的优先档（非法输入按 0 计）。用来决定要不要提示遮蔽关系。 */
export function countQuotaRulePriorityTiers(drafts: QuotaRuleDraft[]): number {
  return new Set(drafts.map((draft) => parseDraftPriority(draft.priorityInput) ?? 0)).size
}
