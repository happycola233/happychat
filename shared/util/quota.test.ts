import { describe, expect, it } from 'vitest'
import type { QuotaRule } from '../types/domain'
import {
  QUOTA_MAX_RULES_PER_POLICY,
  QUOTA_MAX_RULE_PRIORITY,
  describeQuotaRule,
  describeQuotaRuleGroupTitle,
  evaluateQuotaLimit,
  formatQuotaAmount,
  formatQuotaLimit,
  groupQuotaBucketsByRule,
  isQuotaRuleNoOp,
  isQuotaUnlimited,
  normalizeQuotaRules,
  normalizeUserQuotaOverrides,
  pickTightestQuotaBucket,
  quotaRuleRequiresBucketKey,
  resolveEffectiveQuota,
} from './quota'

const monthlyCost = (value: number, id = 'r-cost'): QuotaRule => ({
  id,
  label: null,
  scope: { type: 'all' },
  metric: 'cost',
  limit: { kind: 'amount', value },
  window: { type: 'calendar', period: 'month' },
  priority: 0,
})

const dailyRequests = (value: number, id = 'r-req'): QuotaRule => ({
  id,
  label: '每天次数',
  scope: { type: 'all' },
  metric: 'requests',
  limit: { kind: 'amount', value },
  window: { type: 'calendar', period: 'day' },
  priority: 0,
})

describe('normalizeQuotaRules', () => {
  it('保留合法规则并归一化标签与滚动小时数', () => {
    expect(
      normalizeQuotaRules([
        {
          id: ' rule-1 ',
          label: '  五小时窗口  ',
          scope: { type: 'models', modelIds: ['m1', 'm1', ' m2 '], mode: 'each' },
          metric: 'requests',
          limit: { kind: 'amount', value: 300 },
          window: { type: 'rolling', hours: 5.4 },
        },
      ]),
    ).toEqual([
      {
        id: 'rule-1',
        label: '五小时窗口',
        scope: { type: 'models', modelIds: ['m1', 'm2'], mode: 'each' },
        metric: 'requests',
        limit: { kind: 'amount', value: 300 },
        window: { type: 'rolling', hours: 5 },
        priority: 0,
      },
    ])
  })

  it('保留首次请求起算窗口并归一化小时数', () => {
    const [rule] = normalizeQuotaRules([
      {
        ...dailyRequests(10, 'anchored'),
        window: { type: 'anchored', hours: 4.6 },
      },
    ])
    expect(rule?.window).toEqual({ type: 'anchored', hours: 5 })
  })

  it('非法/脏数据整条丢弃而不是抛错（宁可少一条限制也不误拦）', () => {
    expect(
      normalizeQuotaRules([
        null,
        'nope',
        {
          id: '',
          scope: { type: 'all' },
          metric: 'cost',
          limit: { kind: 'unlimited' },
          window: { type: 'total' },
        },
        { id: 'no-scope', metric: 'cost', limit: { kind: 'unlimited' }, window: { type: 'total' } },
        {
          id: 'bad-metric',
          scope: { type: 'all' },
          metric: 'tokens',
          limit: { kind: 'unlimited' },
          window: { type: 'total' },
        },
        {
          id: 'neg',
          scope: { type: 'all' },
          metric: 'cost',
          limit: { kind: 'amount', value: -5 },
          window: { type: 'total' },
        },
        {
          id: 'zero',
          scope: { type: 'all' },
          metric: 'cost',
          limit: { kind: 'amount', value: 0 },
          window: { type: 'total' },
        },
        {
          id: 'empty-models',
          scope: { type: 'models', modelIds: [], mode: 'each' },
          metric: 'cost',
          limit: { kind: 'unlimited' },
          window: { type: 'total' },
        },
        {
          id: 'bad-window',
          scope: { type: 'all' },
          metric: 'cost',
          limit: { kind: 'unlimited' },
          window: { type: 'weekly' },
        },
      ]),
    ).toEqual([])
    expect(normalizeQuotaRules('not-an-array')).toEqual([])
    expect(normalizeQuotaRules(undefined)).toEqual([])
  })

  it('丢弃重复 id 并限制单策略规则数量', () => {
    const rules = normalizeQuotaRules([monthlyCost(10), monthlyCost(20)])
    expect(rules).toHaveLength(1)
    expect(rules[0]?.limit).toEqual({ kind: 'amount', value: 10 })

    const many = Array.from({ length: QUOTA_MAX_RULES_PER_POLICY + 5 }, (_, index) =>
      monthlyCost(index + 1, `rule-${index}`),
    )
    expect(normalizeQuotaRules(many)).toHaveLength(QUOTA_MAX_RULES_PER_POLICY)
  })

  it('优先级归一化：缺失回落 0，小数取整，越界钳制', () => {
    const priorityOf = (priority: unknown) =>
      normalizeQuotaRules([{ ...monthlyCost(10), priority }])[0]?.priority
    expect(priorityOf(undefined)).toBe(0)
    expect(priorityOf('10')).toBe(0)
    expect(priorityOf(10.4)).toBe(10)
    expect(priorityOf(-5)).toBe(0)
    expect(priorityOf(1000)).toBe(QUOTA_MAX_RULE_PRIORITY)
  })

  it('scope.mode 缺失时按「各自独立」处理', () => {
    const [rule] = normalizeQuotaRules([
      {
        id: 'g',
        scope: { type: 'groups', groupIds: ['g1'] },
        metric: 'cost',
        limit: { kind: 'amount', value: 20 },
        window: { type: 'calendar', period: 'month' },
      },
    ])
    expect(rule?.scope).toEqual({ type: 'groups', groupIds: ['g1'], mode: 'each' })
  })
})

describe('normalizeUserQuotaOverrides', () => {
  it('保留有效覆写与专属规则，丢弃空覆写', () => {
    expect(
      normalizeUserQuotaOverrides({
        rules: {
          'r-cost': { limit: { kind: 'amount', value: 30 } },
          'r-req': { disabled: true },
          'r-x': { limit: { kind: 'amount', value: -1 } },
          '': { disabled: true },
        },
        extraRules: [dailyRequests(50, 'own')],
      }),
    ).toEqual({
      rules: {
        'r-cost': { limit: { kind: 'amount', value: 30 } },
        'r-req': { disabled: true },
      },
      extraRules: [dailyRequests(50, 'own')],
    })
  })

  it('脏输入归一为空对象', () => {
    expect(normalizeUserQuotaOverrides(null)).toEqual({})
    expect(normalizeUserQuotaOverrides({ rules: 'x', extraRules: 3 })).toEqual({})
  })
})

describe('resolveEffectiveQuota', () => {
  const policyRules = [monthlyCost(10), dailyRequests(300)]

  it('无覆写时原样继承并标注来源', () => {
    const resolved = resolveEffectiveQuota(policyRules, {})
    expect(resolved.map((rule) => rule.source)).toEqual(['policy', 'policy'])
    expect(resolved[0]?.limit).toEqual({ kind: 'amount', value: 10 })
  })

  it('覆写只改上限/窗口并标注 override（张三：¥10→$30 场景）', () => {
    const resolved = resolveEffectiveQuota(policyRules, {
      rules: { 'r-cost': { limit: { kind: 'amount', value: 30 } } },
    })
    expect(resolved[0]).toMatchObject({
      id: 'r-cost',
      source: 'override',
      limit: { kind: 'amount', value: 30 },
      // 范围与计量属于模板语义，不被覆写改动
      scope: { type: 'all' },
      metric: 'cost',
    })
    expect(resolved[1]?.source).toBe('policy')
  })

  it('disabled 移除该条继承规则，专属规则追加在后', () => {
    const resolved = resolveEffectiveQuota(policyRules, {
      rules: { 'r-req': { disabled: true } },
      extraRules: [monthlyCost(99, 'own')],
    })
    expect(resolved.map((rule) => [rule.id, rule.source])).toEqual([
      ['r-cost', 'policy'],
      ['own', 'user'],
    ])
  })

  it('专属规则与继承规则 id 冲突时丢弃专属规则', () => {
    const resolved = resolveEffectiveQuota(policyRules, { extraRules: [monthlyCost(99)] })
    expect(resolved).toHaveLength(2)
    expect(resolved[0]?.limit).toEqual({ kind: 'amount', value: 10 })
  })

  it('可用覆写把某条规则改成无限额度', () => {
    const [rule] = resolveEffectiveQuota([monthlyCost(10)], {
      rules: { 'r-cost': { limit: { kind: 'unlimited' } } },
    })
    expect(rule?.limit).toEqual({ kind: 'unlimited' })
    expect(rule?.source).toBe('override')
  })
})

describe('isQuotaRuleNoOp', () => {
  it('只有 0 档豁免是废话规则；高优先级豁免与具体上限都有作用', () => {
    expect(isQuotaRuleNoOp({ limit: { kind: 'unlimited' }, priority: 0 })).toBe(true)
    expect(isQuotaRuleNoOp({ limit: { kind: 'unlimited' }, priority: 5 })).toBe(false)
    expect(isQuotaRuleNoOp({ limit: { kind: 'amount', value: 1 }, priority: 0 })).toBe(false)
  })
})

describe('isQuotaUnlimited', () => {
  it('零规则与全部无限都视为无限额度', () => {
    expect(isQuotaUnlimited([])).toBe(true)
    expect(isQuotaUnlimited([{ limit: { kind: 'unlimited' } }])).toBe(true)
    expect(isQuotaUnlimited([{ limit: { kind: 'amount', value: 1 } }])).toBe(false)
  })
})

describe('evaluateQuotaLimit', () => {
  it('无限额度不产生剩余/占比，也永不拦截', () => {
    expect(evaluateQuotaLimit({ limit: { kind: 'unlimited' }, used: 999 })).toMatchObject({
      effectiveLimit: null,
      remaining: null,
      percent: null,
      blocked: false,
    })
  })

  it('临时额度叠加在基础上限之上（$10 + 赠送 $5 = $15）', () => {
    const evaluation = evaluateQuotaLimit({
      limit: { kind: 'amount', value: 10 },
      used: 12,
      granted: 5,
    })
    expect(evaluation).toMatchObject({
      baseLimit: 10,
      granted: 5,
      effectiveLimit: 15,
      remaining: 3,
      blocked: false,
    })
    expect(evaluation.percent).toBeCloseTo(0.8)
  })

  it('用满即拦截，超支时占比可大于 1（暂停限额期间）', () => {
    expect(evaluateQuotaLimit({ limit: { kind: 'amount', value: 10 }, used: 10 })).toMatchObject({
      remaining: 0,
      blocked: true,
    })
    const over = evaluateQuotaLimit({ limit: { kind: 'amount', value: 10 }, used: 15 })
    expect(over.percent).toBeCloseTo(1.5)
    expect(over.remaining).toBe(0)
    expect(over.blocked).toBe(true)
  })
})

describe('文案', () => {
  it('金额与次数分别格式化，无限额度显式成文', () => {
    expect(formatQuotaAmount('cost', 12.3456)).toBe('$12.35')
    expect(formatQuotaAmount('cost', 0.5)).toBe('$0.500')
    expect(formatQuotaAmount('cost', 0.0001)).toBe('$0.0001')
    expect(formatQuotaAmount('requests', 300)).toBe('300 次')
    expect(formatQuotaLimit('cost', { kind: 'unlimited' })).toBe('豁免（不限额）')
  })

  it('规则摘要串联窗口/范围/上限，非默认优先级前置标注', () => {
    expect(describeQuotaRule(monthlyCost(30))).toBe('每月 · 全部模型 · $30.00')
    expect(describeQuotaRule({ ...monthlyCost(30), priority: 10 })).toBe(
      '优先 10 · 每月 · 全部模型 · $30.00',
    )
    expect(
      describeQuotaRule({
        ...monthlyCost(30),
        limit: { kind: 'unlimited' },
        priority: 10,
        window: { type: 'calendar', period: 'month' },
      }),
    ).toBe('优先 10 · 全部模型 · 豁免（不限额）')
    expect(
      describeQuotaRule(
        {
          scope: { type: 'models', modelIds: ['m1', 'm2', 'm3'], mode: 'each' },
          metric: 'requests',
          limit: { kind: 'amount', value: 20 },
          window: { type: 'rolling', hours: 5 },
        },
        { models: { m1: 'GPT-5.5' } },
      ),
    ).toBe('滚动 5 小时 · GPT-5.5 等 3 个模型·各自独立 · 20 次')
    expect(
      describeQuotaRule(
        {
          scope: { type: 'groups', groupIds: ['g1'], mode: 'shared' },
          metric: 'cost',
          limit: { kind: 'amount', value: 20 },
          window: { type: 'calendar', period: 'month' },
        },
        { groups: { g1: 'Claude' } },
      ),
    ).toBe('每月 · Claude·共享额度 · $20.00')
  })
})

describe('groupQuotaBucketsByRule', () => {
  it('按首次出现的规则顺序收拢独立桶，不按紧张程度重排', () => {
    const groups = groupQuotaBucketsByRule([
      { ruleId: 'week', bucketKey: null, percent: 0.1, blocked: false },
      { ruleId: 'each', bucketKey: 'grok', percent: 0.9, blocked: true },
      { ruleId: 'each', bucketKey: 'deepseek', percent: 0, blocked: false },
      { ruleId: 'month', bucketKey: null, percent: 0.8, blocked: false },
    ])
    expect(groups.map((group) => group.ruleId)).toEqual(['week', 'each', 'month'])
    expect(groups[1]?.buckets.map((bucket) => bucket.bucketKey)).toEqual(['grok', 'deepseek'])
  })
})

describe('pickTightestQuotaBucket', () => {
  it('已耗尽优先于高占比，无限额度垫底', () => {
    expect(
      pickTightestQuotaBucket([
        { ruleId: 'ok', blocked: false, percent: 0.9 },
        { ruleId: 'dead', blocked: true, percent: 1 },
        { ruleId: 'free', blocked: false, percent: null },
      ])?.ruleId,
    ).toBe('dead')
    expect(
      pickTightestQuotaBucket([
        { blocked: false, percent: 0.2 },
        { blocked: false, percent: 0.8 },
        { blocked: false, percent: null },
      ])?.percent,
    ).toBe(0.8)
  })
})

describe('describeQuotaRuleGroupTitle', () => {
  it('有备注用备注；多目标独立额度不把某个模型名抬成整条标题', () => {
    expect(
      describeQuotaRuleGroupTitle([
        {
          label: '其他模型（每周）',
          bucketLabel: 'Grok',
          scope: { type: 'models', modelIds: ['g', 'd'], mode: 'each' },
          window: { type: 'calendar', period: 'week' },
          metric: 'cost',
          limit: { kind: 'amount', value: 0.5 },
          effectiveModelIds: ['g'],
        },
        {
          label: '其他模型（每周）',
          bucketLabel: 'DeepSeek',
          scope: { type: 'models', modelIds: ['g', 'd'], mode: 'each' },
          window: { type: 'calendar', period: 'week' },
          metric: 'cost',
          limit: { kind: 'amount', value: 0.5 },
          effectiveModelIds: ['d'],
        },
      ]),
    ).toBe('其他模型（每周）')
    expect(
      describeQuotaRuleGroupTitle([
        {
          label: null,
          bucketLabel: 'Grok',
          scope: { type: 'models', modelIds: ['g', 'd'], mode: 'each' },
          window: { type: 'calendar', period: 'week' },
          metric: 'cost',
          limit: { kind: 'amount', value: 0.5 },
          effectiveModelIds: ['g'],
        },
        {
          label: null,
          bucketLabel: 'DeepSeek',
          scope: { type: 'models', modelIds: ['g', 'd'], mode: 'each' },
          window: { type: 'calendar', period: 'week' },
          metric: 'cost',
          limit: { kind: 'amount', value: 0.5 },
          effectiveModelIds: ['d'],
        },
      ]),
    ).toBe('每周消费 · 指定模型')
    expect(
      describeQuotaRuleGroupTitle([
        {
          label: null,
          bucketLabel: null,
          scope: { type: 'all' },
          window: { type: 'calendar', period: 'month' },
          metric: 'cost',
          limit: { kind: 'unlimited' },
          effectiveModelIds: null,
        },
      ]),
    ).toBe('全部模型')
  })
})

describe('quotaRuleRequiresBucketKey', () => {
  it('只有「各自独立」的规则需要指定具体目标', () => {
    expect(quotaRuleRequiresBucketKey({ scope: { type: 'all' } })).toBe(false)
    expect(
      quotaRuleRequiresBucketKey({ scope: { type: 'models', modelIds: ['m1'], mode: 'shared' } }),
    ).toBe(false)
    expect(
      quotaRuleRequiresBucketKey({ scope: { type: 'models', modelIds: ['m1'], mode: 'each' } }),
    ).toBe(true)
  })
})
