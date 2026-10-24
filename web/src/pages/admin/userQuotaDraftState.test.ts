import { describe, expect, it } from 'vitest'
import type { QuotaRule, UserQuotaOverrides } from '@shared/types/domain'
import {
  hasUnsavedQuotaDefinitionChanges,
  hiddenQuotaRuleOverrides,
  quotaRuleOverrideDraftFromRule,
  quotaRuleOverrideFromDraft,
  type QuotaRuleOverrideDraft,
} from './userQuotaDraftState'

const savedOverrides: UserQuotaOverrides = {
  rules: {
    'rule-1': {
      limit: { kind: 'amount', value: 10 },
      window: { type: 'calendar', period: 'day' },
    },
  },
}

describe('规则覆写草稿', () => {
  const template: QuotaRule = {
    id: 'rule-1',
    label: null,
    scope: { type: 'all' },
    metric: 'cost',
    limit: { kind: 'amount', value: 1 },
    window: { type: 'anchored', hours: 24 },
    priority: 0,
  }
  const draft: QuotaRuleOverrideDraft = {
    mode: 'override',
    limitUnlimited: false,
    limitInput: '0',
    windowChoice: '',
  }

  it('零额度被提交，重新打开后仍显示覆写 0', () => {
    const override = quotaRuleOverrideFromDraft(draft)!
    expect(override).toEqual({ limit: { kind: 'amount', value: 0 } })
    const overrides = { rules: { [template.id]: override } }
    expect(quotaRuleOverrideDraftFromRule(template, overrides)).toEqual(draft)
    expect(hasUnsavedQuotaDefinitionChanges(null, null, {}, overrides)).toBe(true)
  })

  it.each(['', '   '])('空输入 %j 沿用模板上限，仍可单独覆写周期', (limitInput) => {
    expect(quotaRuleOverrideFromDraft({ ...draft, limitInput })).toBeNull()
    expect(quotaRuleOverrideFromDraft({ ...draft, limitInput, windowChoice: 'month' })).toEqual({
      window: { type: 'calendar', period: 'month' },
    })
  })

  it('继承、停用与无限额度不被残留的 0 输入改变', () => {
    expect(quotaRuleOverrideFromDraft({ ...draft, mode: 'inherit' })).toBeNull()
    expect(quotaRuleOverrideFromDraft({ ...draft, mode: 'disabled' })).toEqual({ disabled: true })
    expect(quotaRuleOverrideFromDraft({ ...draft, limitUnlimited: true })).toEqual({
      limit: { kind: 'unlimited' },
    })
  })
})

describe('hasUnsavedQuotaDefinitionChanges', () => {
  it('忽略对象键顺序，不把等价配置误判为未保存', () => {
    expect(
      hasUnsavedQuotaDefinitionChanges('policy-1', 'policy-1', savedOverrides, {
        rules: {
          'rule-1': {
            window: { period: 'day', type: 'calendar' },
            limit: { value: 10, kind: 'amount' },
          },
        },
      }),
    ).toBe(false)
  })

  it('切换策略后要求先保存', () => {
    expect(
      hasUnsavedQuotaDefinitionChanges('policy-1', 'policy-2', savedOverrides, savedOverrides),
    ).toBe(true)
  })

  it('新增用户专属规则后要求先保存', () => {
    expect(
      hasUnsavedQuotaDefinitionChanges('policy-1', 'policy-1', savedOverrides, {
        ...savedOverrides,
        extraRules: [
          {
            id: 'extra-1',
            label: null,
            scope: { type: 'all' },
            metric: 'requests',
            limit: { kind: 'amount', value: 20 },
            window: { type: 'calendar', period: 'month' },
            priority: 0,
          },
        ],
      }),
    ).toBe(true)
  })

  it('修改继承规则周期后要求先保存', () => {
    expect(
      hasUnsavedQuotaDefinitionChanges('policy-1', 'policy-1', savedOverrides, {
        rules: {
          'rule-1': {
            limit: { kind: 'amount', value: 10 },
            window: { type: 'calendar', period: 'month' },
          },
        },
      }),
    ).toBe(true)
  })

  it('保留当前模板中不可见的旧规则覆写', () => {
    const overrides: UserQuotaOverrides = {
      rules: {
        ...savedOverrides.rules,
        'removed-rule': { disabled: true },
      },
    }
    const rebuilt: UserQuotaOverrides = {
      rules: {
        ...hiddenQuotaRuleOverrides(overrides, ['rule-1']),
        'rule-1': savedOverrides.rules!['rule-1']!,
      },
    }

    expect(rebuilt).toEqual(overrides)
    expect(hasUnsavedQuotaDefinitionChanges('policy-1', 'policy-1', overrides, rebuilt)).toBe(false)
  })
})
