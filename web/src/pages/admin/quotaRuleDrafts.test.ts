import { describe, expect, it } from 'vitest'
import type { QuotaRule } from '@shared/types/domain'
import {
  countQuotaRulePriorityTiers,
  createQuotaRuleDraft,
  draftFromRule,
  draftsToRules,
  moveQuotaRuleDraft,
  ruleFromDraft,
  summarizeQuotaRuleDraft,
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

  it('滚动窗口与首次请求周期校验小时数范围', () => {
    expect(ruleFromDraft(baseDraft({ windowChoice: 'rolling', durationHoursInput: '5' })).ok).toBe(
      true,
    )
    expect(ruleFromDraft(baseDraft({ windowChoice: 'rolling', durationHoursInput: '0' })).ok).toBe(
      false,
    )
    expect(
      ruleFromDraft(baseDraft({ windowChoice: 'rolling', durationHoursInput: '9000' })).ok,
    ).toBe(false)
    expect(
      ruleFromDraft(baseDraft({ windowChoice: 'rolling', durationHoursInput: '1.5' })).ok,
    ).toBe(false)
    const anchored = ruleFromDraft(baseDraft({ windowChoice: 'anchored', durationHoursInput: '5' }))
    expect(anchored.ok && anchored.rule.window).toEqual({ type: 'anchored', hours: 5 })
    // 非小时型窗口时小时数不参与校验
    expect(ruleFromDraft(baseDraft({ durationHoursInput: 'oops' })).ok).toBe(true)
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

describe('summarizeQuotaRuleDraft', () => {
  it('有备注时用备注作标题，右侧给出格式化额度', () => {
    const summary = summarizeQuotaRuleDraft(
      baseDraft({ label: '日常上限', limitInput: '30', windowChoice: 'month' }),
    )
    expect(summary).toMatchObject({
      title: '日常上限',
      subtitle: '全部模型 · 消费金额',
      limitText: '$30.00',
      windowText: '每月',
      priority: null,
      incomplete: false,
    })
  })

  it('没备注时用范围短称作标题；未完成的规则标出来', () => {
    const summary = summarizeQuotaRuleDraft(
      baseDraft({ scopeType: 'models', targetIds: [], limitInput: '' }),
    )
    expect(summary.title).toBe('未选模型')
    expect(summary.subtitle).toBe('消费金额 · 各自独立')
    expect(summary.limitText).toBe('未设上限')
    expect(summary.incomplete).toBe(true)
  })

  it('小时型窗口在芯片里用短标签', () => {
    expect(
      summarizeQuotaRuleDraft(baseDraft({ windowChoice: 'rolling', durationHoursInput: '5' }))
        .windowText,
    ).toBe('滚动 5 小时')
    expect(
      summarizeQuotaRuleDraft(baseDraft({ windowChoice: 'anchored', durationHoursInput: '24' }))
        .windowText,
    ).toBe('起算 1 天')
    expect(summarizeQuotaRuleDraft(baseDraft({ windowChoice: 'total' })).windowText).toBe('永久')
  })

  it('豁免与非零优先级出现在折叠行摘要里', () => {
    const summary = summarizeQuotaRuleDraft(
      baseDraft({ unlimited: true, priorityInput: '10', label: 'mini 豁免' }),
    )
    expect(summary).toMatchObject({
      title: 'mini 豁免',
      limitText: '豁免',
      unlimited: true,
      priority: 10,
      incomplete: false,
    })
  })
})

describe('moveQuotaRuleDraft', () => {
  it('按 id 重排，对不上的 id 原样返回', () => {
    const a = baseDraft({ id: 'a' })
    const b = baseDraft({ id: 'b' })
    const c = baseDraft({ id: 'c' })
    expect(moveQuotaRuleDraft([a, b, c], 'a', 'c').map((draft) => draft.id)).toEqual([
      'b',
      'c',
      'a',
    ])
    expect(moveQuotaRuleDraft([a, b], 'a', 'missing')).toEqual([a, b])
  })
})

describe('countQuotaRulePriorityTiers', () => {
  it('按有效整数优先档去重', () => {
    expect(
      countQuotaRulePriorityTiers([
        baseDraft({ priorityInput: '0' }),
        baseDraft({ id: '2', priorityInput: '10' }),
        baseDraft({ id: '3', priorityInput: '10' }),
      ]),
    ).toBe(2)
    expect(countQuotaRulePriorityTiers([baseDraft(), baseDraft({ id: '2' })])).toBe(1)
  })
})
