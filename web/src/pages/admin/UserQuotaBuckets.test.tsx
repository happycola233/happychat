import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QuotaBucketUsageDTO } from '@shared/types/api'
import { UserQuotaBuckets } from './UserQuotaBuckets'
import { formatQuotaTimestamp, quotaPeriodCopy } from './userQuotaDisplay'

const SHANGHAI_MONTH_START = Date.parse('2026-07-31T16:00:00.000Z')
const SHANGHAI_MONTH_END = Date.parse('2026-08-31T16:00:00.000Z')

const bucket = (patch: Partial<QuotaBucketUsageDTO> = {}): QuotaBucketUsageDTO => ({
  ruleId: 'rule-1',
  bucketKey: null,
  bucketLabel: null,
  label: null,
  source: 'policy',
  scope: { type: 'all' },
  metric: 'cost',
  window: { type: 'calendar', period: 'month' },
  limit: { kind: 'amount', value: 40 },
  priority: 0,
  used: 2.6,
  granted: 0,
  effectiveLimit: 40,
  remaining: 37.4,
  percent: 0.065,
  blocked: false,
  periodActive: true,
  periodStart: SHANGHAI_MONTH_START,
  usageStart: SHANGHAI_MONTH_START,
  periodEnd: SHANGHAI_MONTH_END,
  grants: [],
  invalid: false,
  shadowed: false,
  ...patch,
})

describe('额度周期文案', () => {
  it('按配置时区输出无歧义的年月日与 24 小时时间', () => {
    expect(formatQuotaTimestamp(SHANGHAI_MONTH_START, 'Asia/Shanghai')).toBe('2026/08/01 00:00')
  })

  it('自然周期与活动中的固定周期展示真实起止时间', () => {
    expect(quotaPeriodCopy(bucket(), 'Asia/Shanghai')).toEqual({
      headline: '自然月周期',
      detail: '2026/08/01 00:00 → 2026/09/01 00:00（到点重置）',
    })
    expect(
      quotaPeriodCopy(
        bucket({
          window: { type: 'anchored', hours: 5 },
          periodStart: Date.parse('2026-08-15T08:00:00.000Z'),
          usageStart: Date.parse('2026-08-15T08:00:00.000Z'),
          periodEnd: Date.parse('2026-08-15T13:00:00.000Z'),
        }),
        'Asia/Shanghai',
      ),
    ).toEqual({
      headline: '固定周期 · 5 小时',
      detail: '2026/08/15 16:00 → 2026/08/15 21:00（到点清零）',
    })
  })

  it('未开始、滚动与永久窗口不伪造固定的起止或重置时间', () => {
    expect(
      quotaPeriodCopy(
        bucket({
          window: { type: 'anchored', hours: 5 },
          periodActive: false,
          periodStart: 0,
          usageStart: 0,
          periodEnd: null,
        }),
        'Asia/Shanghai',
      ),
    ).toEqual({
      headline: '固定周期 · 尚未开始',
      detail: '首次请求起 5 小时，空闲时不计时',
    })
    expect(
      quotaPeriodCopy(
        bucket({ window: { type: 'rolling', hours: 5 }, periodEnd: null }),
        'Asia/Shanghai',
      ),
    ).toEqual({
      headline: '滚动窗口 · 5 小时',
      detail: '始终统计当前时刻往前 5 小时，无固定重置点',
    })
    expect(
      quotaPeriodCopy(
        bucket({ window: { type: 'total' }, periodStart: 0, usageStart: 0, periodEnd: null }),
        'Asia/Shanghai',
      ),
    ).toEqual({ headline: '永久累计', detail: '不会自动重置' })
  })
})

describe('UserQuotaBuckets', () => {
  it('同时展示全部额度桶、各自状态、用量、周期与管理员重置时间', () => {
    const resetAt = Date.parse('2026-08-10T02:30:00.000Z')
    const html = renderToStaticMarkup(
      <UserQuotaBuckets
        timezone="Asia/Shanghai"
        warnThreshold={0.8}
        rules={[
          bucket({ label: '月度成本' }),
          bucket({
            ruleId: 'rule-2',
            label: '每日请求',
            metric: 'requests',
            limit: { kind: 'amount', value: 100 },
            effectiveLimit: 120,
            granted: 20,
            used: 96,
            remaining: 24,
            percent: 0.8,
            window: { type: 'calendar', period: 'day' },
            periodStart: Date.parse('2026-08-09T16:00:00.000Z'),
            usageStart: resetAt,
            periodEnd: Date.parse('2026-08-10T16:00:00.000Z'),
          }),
          bucket({
            ruleId: 'rule-3',
            label: '模型豁免',
            limit: { kind: 'unlimited' },
            effectiveLimit: null,
            remaining: null,
            percent: null,
          }),
        ]}
      />,
    )

    expect(html).toContain('全部额度')
    expect(html).toContain('3 项')
    expect(html).toContain('月度成本')
    expect(html).toContain('$2.60')
    expect(html).toContain('自然月周期')
    expect(html).toContain('每日请求')
    expect(html).toContain('接近上限')
    expect(html).toContain('临时 +20 次')
    expect(html).toContain('计量起点：2026/08/10 10:30（管理员已重置）')
    expect(html).toContain('模型豁免')
    expect(html).toContain('无限额度')
    expect(html).toContain('aria-label="全部额度，共 3 项"')
    expect(html).not.toContain('overflow-hidden rounded-xl border')
  })
})
