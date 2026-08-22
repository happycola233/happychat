import { describe, expect, it } from 'vitest'
import type { AdminUserQuotaDTO, QuotaBucketUsageDTO, UserStatDTO } from '@shared/types/api'
import {
  classifyUserQuotaStatus,
  countableQuotaBuckets,
  describeQuotaOverviewFilterWithName,
  rankUsersByQuotaPressure,
  rankUsersByRecentUsage,
  summarizeUserQuotaFleet,
  userMatchesQuotaOverviewFilter,
  userQuotaStatusBadge,
} from './quotaOverview'

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
  used: 2,
  granted: 0,
  effectiveLimit: 10,
  remaining: 8,
  percent: 0.2,
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
  requests: 10,
  conversations: 1,
  messages: 2,
  totalTokens: 100,
  reasoningTokens: 0,
  imageGenerations: 0,
  fileUploads: 0,
  costUsd: 1.25,
  errors: 0,
  successRate: 1,
  lastUsageAt: 1,
  topModels: [],
  ...patch,
})

describe('用户限额总览聚合', () => {
  it('状态分类与列表徽标一致：暂停优先于耗尽，无限优先于接近上限', () => {
    expect(classifyUserQuotaStatus(user({ enforcementPaused: true, blocked: true }), 0.8)).toBe(
      'paused',
    )
    expect(classifyUserQuotaStatus(user({ unlimited: true, rules: [] }), 0.8)).toBe('unlimited')
    expect(classifyUserQuotaStatus(user({ blocked: true }), 0.8)).toBe('exhausted')
    expect(
      classifyUserQuotaStatus(
        user({ rules: [bucket({ percent: 0.85, used: 8.5, remaining: 1.5 })] }),
        0.8,
      ),
    ).toBe('warning')
    expect(classifyUserQuotaStatus(user(), 0.8)).toBe('ok')
    expect(userQuotaStatusBadge('exhausted')).toEqual({
      label: '已耗尽',
      className: expect.stringContaining('rose'),
    })
  })

  it('计量桶忽略豁免、失效和被接管的规则', () => {
    expect(
      countableQuotaBuckets([
        bucket({ limit: { kind: 'unlimited' }, percent: null, effectiveLimit: null }),
        bucket({ ruleId: 'bad', invalid: true, percent: 1, blocked: true }),
        bucket({ ruleId: 'shadow', shadowed: true, percent: 0.99 }),
        bucket({ ruleId: 'ok', used: 3, percent: 0.3 }),
      ]),
    ).toEqual([expect.objectContaining({ ruleId: 'ok' })])
  })

  it('总览数字按全站用户统计：需关注=耗尽+接近，平均占用只看受限额用户', () => {
    const rows = [
      user({
        userId: 'a',
        username: 'a',
        blocked: true,
        rules: [bucket({ percent: 1, blocked: true, used: 10, remaining: 0 })],
      }),
      user({
        userId: 'b',
        username: 'b',
        rules: [bucket({ percent: 0.9, used: 9, remaining: 1 })],
      }),
      user({ userId: 'c', username: 'c' }),
      user({
        userId: 'd',
        username: 'd',
        unlimited: true,
        policyId: null,
        policyName: null,
        usingDefaultPolicy: false,
        rules: [],
      }),
      user({
        userId: 'e',
        username: 'e',
        enforcementPaused: true,
        rules: [bucket({ percent: 0.5 })],
      }),
    ]
    const summary = summarizeUserQuotaFleet(rows, 0.8, [
      stat({ userId: 'a', costUsd: 4, requests: 8 }),
      stat({ userId: 'b', costUsd: 2, requests: 3 }),
    ])

    expect(summary.total).toBe(5)
    expect(summary.limited).toBe(4)
    expect(summary.attention).toBe(2)
    expect(summary.counts).toEqual({
      exhausted: 1,
      warning: 1,
      ok: 1,
      paused: 1,
      unlimited: 1,
    })
    expect(summary.averageTightness).toBeCloseTo((1 + 0.9 + 0.2 + 0.5) / 4)
    expect(summary.recentCostUsd).toBe(6)
    expect(summary.recentRequests).toBe(11)
    expect(summary.policies).toEqual([
      { policyId: 'plus', name: 'Plus', count: 4, usingDefault: true },
      { policyId: null, name: '无策略', count: 1, usingDefault: false },
    ])
  })

  it('暂停的无限额度用户仍不计入受限额人数', () => {
    const summary = summarizeUserQuotaFleet(
      [user({ enforcementPaused: true, unlimited: true, rules: [] })],
      0.8,
    )

    expect(summary.counts.paused).toBe(1)
    expect(summary.counts.unlimited).toBe(0)
    expect(summary.limited).toBe(0)
  })

  it('用量排行按近窗成本排序，并按第一名归一化占比；没有成本时回退请求数', () => {
    const users = [
      user({ userId: 'a', username: 'alice' }),
      user({ userId: 'b', username: 'bob', unlimited: true, rules: [] }),
      user({ userId: 'c', username: 'cara' }),
    ]
    const byCost = rankUsersByRecentUsage(
      users,
      [
        stat({ userId: 'b', username: 'bob', costUsd: 8, requests: 2 }),
        stat({ userId: 'a', username: 'alice', costUsd: 4, requests: 20 }),
        stat({ userId: 'missing', costUsd: 99, requests: 99 }),
        stat({ userId: 'c', username: 'cara', costUsd: 0, requests: 0 }),
      ],
      0.8,
    )
    expect(byCost.map((row) => row.user.username)).toEqual(['bob', 'alice'])
    expect(byCost[0]?.share).toBe(1)
    expect(byCost[1]?.share).toBe(0.5)
    expect(byCost[0]?.status).toBe('unlimited')

    const byRequests = rankUsersByRecentUsage(
      users,
      [
        stat({ userId: 'a', costUsd: 0, requests: 10 }),
        stat({ userId: 'c', username: 'cara', costUsd: 0, requests: 4 }),
      ],
      0.8,
    )
    expect(byRequests.map((row) => [row.user.username, row.share])).toEqual([
      ['alice', 1],
      ['cara', 0.4],
    ])
  })

  it('压力排行忽略未开始的 0% 用量，已耗尽排在接近上限前面', () => {
    const rows = rankUsersByQuotaPressure(
      [
        user({
          userId: 'idle',
          username: 'idle',
          rules: [bucket({ percent: 0, used: 0, remaining: 10 })],
        }),
        user({
          userId: 'warn',
          username: 'warn',
          rules: [bucket({ percent: 0.82, used: 8.2, remaining: 1.8 })],
        }),
        user({
          userId: 'out',
          username: 'out',
          blocked: true,
          rules: [bucket({ percent: 1.1, used: 11, remaining: 0, blocked: true })],
        }),
        user({
          userId: 'free',
          username: 'free',
          unlimited: true,
          rules: [],
        }),
      ],
      0.8,
    )
    expect(rows.map((row) => row.user.username)).toEqual(['out', 'warn'])
    expect(rows[0]?.status).toBe('exhausted')
    expect(rows[1]?.detail).toContain('每月')
    expect(rows[1]?.detail).toContain('$8.20 / $10.00')
  })

  it('总览筛选按状态或策略收窄，文案用策略名而不是占位', () => {
    const alice = user()
    const free = user({
      userId: 'd',
      username: 'dana',
      policyId: null,
      policyName: null,
      unlimited: true,
      rules: [],
    })
    expect(userMatchesQuotaOverviewFilter(alice, { type: 'status', status: 'ok' }, 0.8)).toBe(true)
    expect(userMatchesQuotaOverviewFilter(alice, { type: 'status', status: 'warning' }, 0.8)).toBe(
      false,
    )
    expect(userMatchesQuotaOverviewFilter(free, { type: 'policy', policyId: null }, 0.8)).toBe(true)
    expect(userMatchesQuotaOverviewFilter(alice, { type: 'policy', policyId: null }, 0.8)).toBe(
      false,
    )
    expect(
      describeQuotaOverviewFilterWithName({ type: 'policy', policyId: 'plus' }, [
        { policyId: 'plus', name: 'Plus', count: 1, usingDefault: true },
      ]),
    ).toBe('Plus')
  })
})
