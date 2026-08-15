import { describe, expect, it } from 'vitest'
import type { QuotaBucketUsageDTO } from '@shared/types/api'
import { resolveQuotaRulesRefetchInterval } from './quotaRefetch'

const bucket = (patch: Partial<QuotaBucketUsageDTO> = {}): QuotaBucketUsageDTO => ({
  ruleId: 'rule-1',
  bucketKey: null,
  bucketLabel: null,
  label: null,
  source: 'policy',
  scope: { type: 'all' },
  metric: 'cost',
  window: { type: 'calendar', period: 'day' },
  limit: { kind: 'amount', value: 10 },
  priority: 0,
  used: 2,
  granted: 0,
  effectiveLimit: 10,
  remaining: 8,
  percent: 0.2,
  blocked: false,
  periodActive: true,
  periodStart: 0,
  usageStart: 0,
  periodEnd: 20_000,
  grants: [],
  invalid: false,
  shadowed: false,
  ...patch,
})

describe('resolveQuotaRulesRefetchInterval', () => {
  it('管理页会在最近的固定周期边界后刷新，即使用量尚未接近上限', () => {
    expect(
      resolveQuotaRulesRefetchInterval(
        [bucket()],
        { warnThreshold: 0.8, refreshAllFixedBoundaries: true },
        10_000,
      ),
    ).toBe(10_250)
  })

  it('滚动窗口仅在有效额度接近上限时轮询', () => {
    const rolling = bucket({ window: { type: 'rolling', hours: 5 }, periodEnd: null })
    expect(
      resolveQuotaRulesRefetchInterval([rolling], {
        warnThreshold: 0.8,
        refreshAllFixedBoundaries: true,
      }),
    ).toBe(false)
    expect(
      resolveQuotaRulesRefetchInterval(
        [
          { ...rolling, percent: 0.8 },
          { ...rolling, ruleId: 'shadowed', percent: 1, shadowed: true },
        ],
        { warnThreshold: 0.8, refreshAllFixedBoundaries: true },
      ),
    ).toBe(30_000)
  })

  it('未开始、永久累计与豁免规则不会启动定时器', () => {
    expect(
      resolveQuotaRulesRefetchInterval(
        [
          bucket({
            window: { type: 'anchored', hours: 5 },
            periodActive: false,
            periodEnd: null,
          }),
          bucket({ ruleId: 'total', window: { type: 'total' }, periodEnd: null }),
          bucket({
            ruleId: 'unlimited',
            limit: { kind: 'unlimited' },
            effectiveLimit: null,
            remaining: null,
            percent: null,
          }),
        ],
        { warnThreshold: 0.8, refreshAllFixedBoundaries: true },
      ),
    ).toBe(false)
  })
})
