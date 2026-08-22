import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminUserQuotaDTO, QuotaBucketUsageDTO, UserStatDTO } from '@shared/types/api'
import { UserQuotaOverview } from './UserQuotaOverview'

const bucket = (patch: Partial<QuotaBucketUsageDTO> = {}): QuotaBucketUsageDTO => ({
  ruleId: 'rule-1',
  bucketKey: null,
  bucketLabel: null,
  targetLabels: null,
  effectiveModelIds: null,
  label: '月度成本',
  source: 'policy',
  scope: { type: 'all' },
  metric: 'cost',
  window: { type: 'calendar', period: 'month' },
  limit: { kind: 'amount', value: 10 },
  priority: 0,
  used: 8.2,
  granted: 0,
  effectiveLimit: 10,
  remaining: 1.8,
  percent: 0.82,
  blocked: false,
  periodActive: true,
  periodStart: 1,
  usageStart: 1,
  periodEnd: 2,
  grants: [],
  invalid: false,
  shadowed: false,
  ...patch,
})

const user = (patch: Partial<AdminUserQuotaDTO> = {}): AdminUserQuotaDTO => ({
  userId: 'u1',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  role: 'user',
  disabled: false,
  policyId: 'plus',
  policyName: 'Plus',
  usingDefaultPolicy: true,
  enforcementPaused: false,
  pausedAt: null,
  note: null,
  unlimited: false,
  overrideCount: 0,
  rules: [bucket()],
  blocked: false,
  lastUsageAt: 1,
  ...patch,
})

const stat = (patch: Partial<UserStatDTO> = {}): UserStatDTO => ({
  userId: 'u1',
  username: 'alice',
  displayName: 'Alice',
  requests: 12,
  conversations: 1,
  messages: 2,
  totalTokens: 100,
  reasoningTokens: 0,
  imageGenerations: 0,
  fileUploads: 0,
  costUsd: 3.5,
  errors: 0,
  successRate: 1,
  lastUsageAt: 1,
  topModels: [],
  ...patch,
})

describe('UserQuotaOverview', () => {
  it('一眼展示健康数字、用量排行和最接近上限', () => {
    const html = renderToStaticMarkup(
      <UserQuotaOverview
        users={[
          user(),
          user({
            userId: 'u2',
            username: 'bob',
            displayName: null,
            avatarUrl: '/api/auth/avatar/u2?v=face.webp',
            unlimited: true,
            policyId: null,
            policyName: null,
            usingDefaultPolicy: false,
            rules: [],
          }),
        ]}
        stats={[stat(), stat({ userId: 'u2', username: 'bob', costUsd: 9, requests: 4 })]}
        statsLoading={false}
        rangeKey="7d"
        onRangeKeyChange={vi.fn()}
        warnThreshold={0.8}
        filter={null}
        onFilterChange={vi.fn()}
        onSelectUser={vi.fn()}
      />,
    )

    expect(html).toContain('总览')
    expect(html).toContain('受限额用户')
    expect(html).toContain('需关注')
    expect(html).toContain('平均占用')
    expect(html).toContain('近 7 天消费')
    expect(html).toContain('用量最多')
    expect(html).toContain('最接近上限')
    expect(html).toContain('alice')
    expect(html).toContain('bob')
    expect(html).toContain('/api/auth/avatar/u2?v=face.webp')
    expect(html).toContain('$9.00')
    expect(html).toContain('82%')
    expect(html).toContain('Plus')
    expect(html).toContain('无策略')
    expect(html).toContain('接近上限')
    expect(html).toContain('无限额度')
  })

  it('空数据时不编造排行，并标明正在筛选', () => {
    const html = renderToStaticMarkup(
      <UserQuotaOverview
        users={[]}
        stats={[]}
        statsLoading={false}
        rangeKey="24h"
        onRangeKeyChange={vi.fn()}
        warnThreshold={0.8}
        filter={{ type: 'status', status: 'warning' }}
        onFilterChange={vi.fn()}
        onSelectUser={vi.fn()}
      />,
    )
    expect(html).toContain('正在查看：接近上限')
    expect(html).toContain('这个时间窗还没有对话用量')
    expect(html).toContain('还没有人开始消耗额度')
    expect(html).toContain('近 24 小时消费')
  })

  it('暂停的无限额度用户在展示暂停状态时仍按无限额度汇总', () => {
    const html = renderToStaticMarkup(
      <UserQuotaOverview
        users={[user({ enforcementPaused: true, unlimited: true, rules: [] })]}
        stats={[]}
        statsLoading={false}
        rangeKey="7d"
        onRangeKeyChange={vi.fn()}
        warnThreshold={0.8}
        filter={null}
        onFilterChange={vi.fn()}
        onSelectUser={vi.fn()}
      />,
    )

    expect(html).toContain('0 / 1')
    expect(html).toContain('1 人无限额度')
    expect(html).toContain('限额已暂停')
  })
})
