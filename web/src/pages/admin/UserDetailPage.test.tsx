import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AdminUserQuotaDetailDTO, QuotaBucketUsageDTO } from '@shared/types/api'
import { UserDetailQuotaCard } from './UserDetailPage'

const periodStart = Date.parse('2026-07-31T16:00:00.000Z')
const periodEnd = Date.parse('2026-08-31T16:00:00.000Z')

const rule: QuotaBucketUsageDTO = {
  ruleId: 'monthly-cost',
  bucketKey: null,
  bucketLabel: null,
  effectiveModelIds: null,
  label: '月度成本',
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
  periodStart,
  usageStart: periodStart,
  periodEnd,
  grants: [],
  invalid: false,
  shadowed: false,
}

const detail: AdminUserQuotaDetailDTO = {
  userId: 'user-1',
  username: 'demo',
  displayName: null,
  quotaTimezone: 'Asia/Shanghai',
  warnThreshold: 0.8,
  policyId: 'policy-1',
  policyName: 'Plus',
  usingDefaultPolicy: true,
  enforcementPaused: false,
  pausedAt: null,
  note: null,
  overrides: {},
  effectiveRules: [],
  rules: [rule],
  adjustments: [],
  byModel: [],
}

describe('UserDetailQuotaCard', () => {
  it('在用户明细中展示全部额度与按额度时区格式化的周期起止', () => {
    const html = renderToStaticMarkup(<UserDetailQuotaCard detail={detail} />)

    expect(html).toContain('周期时间按 中国标准时间（UTC+8） 显示')
    expect(html).toContain('全部额度')
    expect(html).toContain('月度成本')
    expect(html).toContain('2026/08/01 00:00 → 2026/09/01 00:00（到点重置）')
  })
})
