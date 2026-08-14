import { describe, expect, it } from 'vitest'
import {
  quotaBatchAssignSchema,
  quotaGrantCreateSchema,
  quotaPolicyCreateSchema,
  quotaPolicyUpdateSchema,
  quotaResetSchema,
  quotaRuleSchema,
  userQuotaUpdateSchema,
} from './quota'

const validRule = {
  id: 'rule-1',
  scope: { type: 'all' as const },
  metric: 'cost' as const,
  limit: { kind: 'amount' as const, value: 10 },
  window: { type: 'calendar' as const, period: 'month' as const },
}

describe('quotaRuleSchema', () => {
  it('接受三种范围与三种窗口', () => {
    expect(quotaRuleSchema.safeParse(validRule).success).toBe(true)
    expect(
      quotaRuleSchema.safeParse({
        ...validRule,
        scope: { type: 'models', modelIds: ['m1'], mode: 'each' },
        window: { type: 'rolling', hours: 5 },
      }).success,
    ).toBe(true)
    expect(
      quotaRuleSchema.safeParse({
        ...validRule,
        scope: { type: 'groups', groupIds: ['g1'], mode: 'shared' },
        window: { type: 'total' },
        limit: { kind: 'unlimited' },
      }).success,
    ).toBe(true)
  })

  it('空标签归一为 null', () => {
    const parsed = quotaRuleSchema.parse({ ...validRule, label: '   ' })
    expect(parsed.label).toBeNull()
  })

  it('拒绝非正上限、空目标、重复目标与越界滚动窗口', () => {
    expect(
      quotaRuleSchema.safeParse({ ...validRule, limit: { kind: 'amount', value: 0 } }).success,
    ).toBe(false)
    expect(
      quotaRuleSchema.safeParse({
        ...validRule,
        scope: { type: 'models', modelIds: [], mode: 'each' },
      }).success,
    ).toBe(false)
    expect(
      quotaRuleSchema.safeParse({
        ...validRule,
        scope: { type: 'models', modelIds: ['m1', 'm1'], mode: 'each' },
      }).success,
    ).toBe(false)
    expect(
      quotaRuleSchema.safeParse({ ...validRule, window: { type: 'rolling', hours: 0 } }).success,
    ).toBe(false)
    expect(
      quotaRuleSchema.safeParse({ ...validRule, window: { type: 'rolling', hours: 9000 } }).success,
    ).toBe(false)
    expect(
      quotaRuleSchema.safeParse({ ...validRule, window: { type: 'rolling', hours: 1.5 } }).success,
    ).toBe(false)
  })

  it('优先级默认 0，只接受 0–99 的整数', () => {
    expect(quotaRuleSchema.parse(validRule).priority).toBe(0)
    expect(quotaRuleSchema.parse({ ...validRule, priority: 10 }).priority).toBe(10)
    expect(quotaRuleSchema.safeParse({ ...validRule, priority: -1 }).success).toBe(false)
    expect(quotaRuleSchema.safeParse({ ...validRule, priority: 100 }).success).toBe(false)
    expect(quotaRuleSchema.safeParse({ ...validRule, priority: 1.5 }).success).toBe(false)
  })

  it('次数型上限必须是整数（金额可以有小数）', () => {
    expect(
      quotaRuleSchema.safeParse({
        ...validRule,
        metric: 'requests',
        limit: { kind: 'amount', value: 1.5 },
      }).success,
    ).toBe(false)
    expect(
      quotaRuleSchema.safeParse({ ...validRule, limit: { kind: 'amount', value: 1.5 } }).success,
    ).toBe(true)
  })
})

describe('quotaPolicyCreateSchema', () => {
  it('零规则（无限额度策略）合法，rules 默认空数组', () => {
    const parsed = quotaPolicyCreateSchema.parse({ name: '朋友' })
    expect(parsed.rules).toEqual([])
    expect(parsed.isDefault).toBe(false)
  })

  it('规则 id 重复时拒绝', () => {
    expect(
      quotaPolicyCreateSchema.safeParse({ name: 'x', rules: [validRule, validRule] }).success,
    ).toBe(false)
  })

  it('名称必填且有长度上限', () => {
    expect(quotaPolicyCreateSchema.safeParse({ name: '  ' }).success).toBe(false)
    expect(quotaPolicyCreateSchema.safeParse({ name: 'a'.repeat(41) }).success).toBe(false)
  })

  it('更新时必须带内容', () => {
    expect(quotaPolicyUpdateSchema.safeParse({}).success).toBe(false)
    expect(quotaPolicyUpdateSchema.safeParse({ rules: [] }).success).toBe(true)
  })
})

describe('userQuotaUpdateSchema', () => {
  it('policyId=null 表示回到默认策略，默认不暂停', () => {
    const parsed = userQuotaUpdateSchema.parse({ policyId: null })
    expect(parsed).toMatchObject({ policyId: null, enforcementPaused: false, overrides: {} })
  })

  it('拒绝空覆写对象', () => {
    expect(
      userQuotaUpdateSchema.safeParse({ policyId: null, overrides: { rules: { 'r-1': {} } } })
        .success,
    ).toBe(false)
  })

  it('接受逐规则覆写与专属规则', () => {
    expect(
      userQuotaUpdateSchema.safeParse({
        policyId: 'p1',
        overrides: {
          rules: { 'r-1': { limit: { kind: 'amount', value: 30 } }, 'r-2': { disabled: true } },
          extraRules: [validRule],
        },
        enforcementPaused: true,
      }).success,
    ).toBe(true)
  })
})

describe('临时额度与批量指派', () => {
  it('赠送额度必须为正数', () => {
    expect(quotaGrantCreateSchema.safeParse({ ruleId: 'r', amount: 5 }).success).toBe(true)
    expect(quotaGrantCreateSchema.safeParse({ ruleId: 'r', amount: 0 }).success).toBe(false)
    expect(quotaGrantCreateSchema.safeParse({ ruleId: '', amount: 5 }).success).toBe(false)
  })

  it('重置：只给 bucketKey 不给 ruleId 被拒（否则会被当成「重置全部」）', () => {
    expect(quotaResetSchema.safeParse({}).success).toBe(true)
    expect(quotaResetSchema.safeParse({ ruleId: 'r', bucketKey: 'm1' }).success).toBe(true)
    expect(quotaResetSchema.safeParse({ bucketKey: 'm1' }).success).toBe(false)
  })

  it('批量指派拒绝空列表与重复项', () => {
    expect(quotaBatchAssignSchema.safeParse({ userIds: [], policyId: null }).success).toBe(false)
    expect(quotaBatchAssignSchema.safeParse({ userIds: ['u1', 'u1'], policyId: 'p' }).success).toBe(
      false,
    )
    expect(
      quotaBatchAssignSchema.safeParse({ userIds: ['u1', 'u2'], policyId: null }).success,
    ).toBe(true)
  })
})
