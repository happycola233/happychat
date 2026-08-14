import { describe, expect, it } from 'vitest'
import type { MyQuotaDTO, QuotaBucketUsageDTO } from '@shared/types/api'
import { resolveQuotaNotice } from './useQuota'

const bucket = (patch: Partial<QuotaBucketUsageDTO> = {}): QuotaBucketUsageDTO => ({
  ruleId: 'r-1',
  bucketKey: null,
  bucketLabel: null,
  label: null,
  source: 'policy',
  scope: { type: 'all' },
  metric: 'cost',
  window: { type: 'calendar', period: 'month' },
  limit: { kind: 'amount', value: 10 },
  priority: 0,
  used: 5,
  granted: 0,
  effectiveLimit: 10,
  remaining: 5,
  percent: 0.5,
  blocked: false,
  periodStart: 0,
  usageStart: 0,
  periodEnd: 1,
  grants: [],
  invalid: false,
  shadowed: false,
  ...patch,
})

const quota = (patch: Partial<MyQuotaDTO> = {}): MyQuotaDTO => ({
  enabled: true,
  paused: false,
  unlimited: false,
  policyName: '默认用户',
  warnThreshold: 0.8,
  rules: [bucket()],
  blockedModelIds: [],
  ...patch,
})

describe('resolveQuotaNotice', () => {
  it('未开启限额 / 无限额度 / 数据未到达时都不提示', () => {
    expect(resolveQuotaNotice(undefined, 'm1').level).toBe('none')
    expect(resolveQuotaNotice(quota({ enabled: false }), 'm1').level).toBe('none')
    expect(resolveQuotaNotice(quota({ unlimited: true }), 'm1').level).toBe('none')
    expect(
      resolveQuotaNotice(quota({ rules: [bucket({ limit: { kind: 'unlimited' } })] }), 'm1').level,
    ).toBe('none')
  })

  it('用量在阈值以下时保持安静', () => {
    expect(resolveQuotaNotice(quota(), 'm1').level).toBe('none')
  })

  it('达到预警阈值时提示「即将用尽」并给出最紧张的规则', () => {
    const state = resolveQuotaNotice(
      quota({
        rules: [
          bucket({ ruleId: 'low', percent: 0.5 }),
          bucket({ ruleId: 'high', percent: 0.92, used: 9.2, remaining: 0.8 }),
        ],
      }),
      'm1',
    )
    expect(state.level).toBe('warning')
    expect(state.rule?.ruleId).toBe('high')
  })

  it('全局规则耗尽 → 已耗尽（不区分模型）', () => {
    const state = resolveQuotaNotice(
      quota({
        rules: [bucket({ blocked: true, used: 10, remaining: 0, percent: 1 })],
        blockedModelIds: ['m1', 'm2'],
      }),
      'm1',
    )
    expect(state.level).toBe('exhausted')
    expect(state.modelScoped).toBe(false)
  })

  it('按模型的独立额度耗尽 → 提示可切换其他模型', () => {
    const state = resolveQuotaNotice(
      quota({
        rules: [
          bucket({
            scope: { type: 'models', modelIds: ['m1'], mode: 'each' },
            bucketKey: 'm1',
            bucketLabel: 'GPT-5.5',
            blocked: true,
          }),
        ],
        blockedModelIds: ['m1'],
      }),
      'm1',
    )
    expect(state.level).toBe('model-exhausted')
    expect(state.modelScoped).toBe(true)
    expect(state.rule?.bucketLabel).toBe('GPT-5.5')
  })

  it('别的模型额度用尽但当前模型可用时不打扰用户', () => {
    const state = resolveQuotaNotice(
      quota({
        rules: [
          bucket({
            scope: { type: 'models', modelIds: ['m2'], mode: 'each' },
            bucketKey: 'm2',
            blocked: true,
          }),
        ],
        blockedModelIds: ['m2'],
      }),
      'm1',
    )
    expect(state.level).toBe('none')
  })

  it('暂停限额时说明「已超支但仍可使用」', () => {
    const state = resolveQuotaNotice(
      quota({
        paused: true,
        rules: [bucket({ blocked: true, used: 15, percent: 1.5 })],
        blockedModelIds: [],
      }),
      'm1',
    )
    expect(state.level).toBe('paused')
    expect(state.rule?.used).toBe(15)
  })

  it('失效规则（目标已删除）不产生任何提示', () => {
    expect(
      resolveQuotaNotice(
        quota({ rules: [bucket({ invalid: true, blocked: false, percent: 5 })] }),
        'm1',
      ).level,
    ).toBe('none')
  })
})
