import type { QuotaMetric, QuotaRule } from '@shared/types/domain'
import { QUOTA_MAX_RULES_PER_POLICY, QUOTA_MAX_RULE_PRIORITY } from '@shared/util/quota'
import { QUOTA_HOURLY_WINDOW_MAX_HOURS } from '@shared/util/quotaWindow'
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
  if (
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
      window:
        draft.windowChoice === 'rolling' || draft.windowChoice === 'anchored'
          ? { type: draft.windowChoice, hours }
          : draft.windowChoice === 'total'
            ? { type: 'total' }
            : { type: 'calendar', period: draft.windowChoice },
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
