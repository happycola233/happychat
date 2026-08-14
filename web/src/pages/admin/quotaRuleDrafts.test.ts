import { describe, expect, it } from 'vitest'
import type { QuotaRule } from '@shared/types/domain'
import {
  createQuotaRuleDraft,
  draftFromRule,
  draftsToRules,
  ruleFromDraft,
  type QuotaRuleDraft,
} from './quotaRuleDrafts'

const baseDraft = (patch: Partial<QuotaRuleDraft> = {}): QuotaRuleDraft => ({
  ...createQuotaRuleDraft(),
  id: 'rule-1',
  limitInput: '10',
  ...patch,
})

describe('ruleFromDraft', () => {
  it('把表单字段折回联合类型', () => {
    const result = ruleFromDraft(baseDraft({ label: ' 每月上限 ' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rule).toEqual({
      id: 'rule-1',
      label: '每月上限',
      scope: { type: 'all' },
      metric: 'cost',
      limit: { kind: 'amount', value: 10 },
      window: { type: 'calendar', period: 'month' },
      priority: 0,
    })
  })

  it('「不限」忽略上限输入框内容', () => {
    const result = ruleFromDraft(baseDraft({ unlimited: true, limitInput: 'abc' }))
    expect(result.ok && result.rule.limit).toEqual({ kind: 'unlimited' })
  })

  it('指定模型但未选择目标时报错', () => {
    expect(ruleFromDraft(baseDraft({ scopeType: 'models' }))).toEqual({
      ok: false,
      message: '请选择至少一个模型',
    })
    expect(ruleFromDraft(baseDraft({ scopeType: 'groups' }))).toEqual({
      ok: false,
      message: '请选择至少一个分组',
    })
  })

  it('上限必须是大于 0 的数；次数必须为整数', () => {
    expect(ruleFromDraft(baseDraft({ limitInput: '' })).ok).toBe(false)
    expect(ruleFromDraft(baseDraft({ limitInput: '0' })).ok).toBe(false)
    expect(ruleFromDraft(baseDraft({ limitInput: '-3' })).ok).toBe(false)
    expect(ruleFromDraft(baseDraft({ limitInput: 'abc' })).ok).toBe(false)
    expect(ruleFromDraft(baseDraft({ metric: 'requests', limitInput: '3.5' })).ok).toBe(false)
    expect(ruleFromDraft(baseDraft({ metric: 'requests', limitInput: '300' })).ok).toBe(true)
    // 金额允许小数
    expect(ruleFromDraft(baseDraft({ metric: 'cost', limitInput: '2.5' })).ok).toBe(true)
  })

  it('滚动窗口校验小时数范围', () => {
    expect(ruleFromDraft(baseDraft({ windowChoice: 'rolling', rollingHoursInput: '5' })).ok).toBe(
      true,
    )
    expect(ruleFromDraft(baseDraft({ windowChoice: 'rolling', rollingHoursInput: '0' })).ok).toBe(
      false,
    )
    expect(
      ruleFromDraft(baseDraft({ windowChoice: 'rolling', rollingHoursInput: '9000' })).ok,
    ).toBe(false)
    expect(ruleFromDraft(baseDraft({ windowChoice: 'rolling', rollingHoursInput: '1.5' })).ok).toBe(
      false,
    )
    // 非滚动窗口时小时数不参与校验
    expect(ruleFromDraft(baseDraft({ rollingHoursInput: 'oops' })).ok).toBe(true)
  })

  it('模型/分组范围携带独立或共享模式', () => {
    const each = ruleFromDraft(
      baseDraft({ scopeType: 'models', targetIds: ['m1', 'm2'], mode: 'each' }),
    )
    expect(each.ok && each.rule.scope).toEqual({
      type: 'models',
      modelIds: ['m1', 'm2'],
      mode: 'each',
    })
    const shared = ruleFromDraft(
      baseDraft({ scopeType: 'groups', targetIds: ['g1'], mode: 'shared' }),
    )
    expect(shared.ok && shared.rule.scope).toEqual({
      type: 'groups',
      groupIds: ['g1'],
      mode: 'shared',
    })
  })
})

describe('draftFromRule', () => {
  it('往返保真，且保留原有规则 id（覆写与临时额度都绑定它）', () => {
    const rule: QuotaRule = {
      id: 'stable-id',
      label: null,
      scope: { type: 'models', modelIds: ['m1'], mode: 'shared' },
      metric: 'requests',
      limit: { kind: 'amount', value: 20 },
      window: { type: 'rolling', hours: 168 },
      priority: 0,
    }
    const roundTrip = ruleFromDraft(draftFromRule(rule))
    expect(roundTrip.ok && roundTrip.rule).toEqual(rule)
  })

  it('无限额度规则回填为「不限」开关', () => {
    const draft = draftFromRule({
      id: 'x',
      label: '不限',
      scope: { type: 'all' },
      metric: 'cost',
      limit: { kind: 'unlimited' },
      window: { type: 'total' },
      priority: 0,
    })
    expect(draft).toMatchObject({ unlimited: true, limitInput: '', windowChoice: 'total' })
  })
})

describe('draftsToRules', () => {
  it('全部合法时返回规则数组', () => {
    const result = draftsToRules([baseDraft(), baseDraft({ id: 'rule-2', limitInput: '5' })])
    expect(result.ok && result.rules).toHaveLength(2)
  })

  it('定位第一条非法规则的位置与原因', () => {
    const result = draftsToRules([baseDraft(), baseDraft({ id: 'rule-2', limitInput: '' })])
    expect(result).toMatchObject({ ok: false, index: 1 })
  })

  it('空列表合法（等于无限额度策略）', () => {
    expect(draftsToRules([])).toEqual({ ok: true, rules: [] })
  })
})

describe('createQuotaRuleDraft', () => {
  it('每次生成新的稳定 id，默认为「全部模型 · 每月 · 消费金额」', () => {
    const first = createQuotaRuleDraft()
    const second = createQuotaRuleDraft()
    expect(first.id).not.toBe(second.id)
    expect(first).toMatchObject({ scopeType: 'all', metric: 'cost', windowChoice: 'month' })
  })
})
