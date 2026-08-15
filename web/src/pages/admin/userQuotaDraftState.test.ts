import { describe, expect, it } from 'vitest'
import type { UserQuotaOverrides } from '@shared/types/domain'
import { hasUnsavedQuotaDefinitionChanges, hiddenQuotaRuleOverrides } from './userQuotaDraftState'

const savedOverrides: UserQuotaOverrides = {
  rules: {
    'rule-1': {
      limit: { kind: 'amount', value: 10 },
      window: { type: 'calendar', period: 'day' },
    },
  },
}

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
