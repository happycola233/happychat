import type { AdminUserQuotaDTO, QuotaBucketUsageDTO, UserStatDTO } from '@shared/types/api'
import {
  describeQuotaRuleGroupTitle,
  formatQuotaAmount,
  pickTightestQuotaBucket,
} from '@shared/util/quota'
import { describeQuotaWindow } from '@shared/util/quotaWindow'
import type { RangeKey } from '../../lib/dateRange'

/** 用户行总状态：与列表徽标、总览筛选共用同一套判定。 */
export const USER_QUOTA_FLEET_STATUSES = [
  'ok',
  'warning',
  'exhausted',
  'paused',
  'unlimited',
] as const

export type UserQuotaFleetStatus = (typeof USER_QUOTA_FLEET_STATUSES)[number]

export type UserQuotaOverviewFilter =
  | { type: 'status'; status: UserQuotaFleetStatus }
  | { type: 'policy'; policyId: string | null }

export const QUOTA_OVERVIEW_RANGES = [
  { key: '24h', label: '24 小时' },
  { key: '7d', label: '7 天' },
  { key: '30d', label: '30 天' },
] as const satisfies readonly { key: Exclude<RangeKey, 'all'>; label: string }[]

export type QuotaOverviewRangeKey = (typeof QUOTA_OVERVIEW_RANGES)[number]['key']

export const QUOTA_OVERVIEW_RANK_LIMIT = 6

export const USER_QUOTA_STATUS_META: Record<
  UserQuotaFleetStatus,
  { label: string; badgeClass: string; barClass: string; glyphClass: string }
> = {
  ok: {
    label: '正常',
    badgeClass: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    barClass: 'bg-emerald-500 dark:bg-emerald-400',
    glyphClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  warning: {
    label: '接近上限',
    badgeClass: 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-200',
    barClass: 'bg-amber-500 dark:bg-amber-400',
    glyphClass: 'bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
  },
  exhausted: {
    label: '已耗尽',
    badgeClass: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
    barClass: 'bg-rose-500 dark:bg-rose-400',
    glyphClass: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
  paused: {
    label: '限额已暂停',
    badgeClass: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    barClass: 'bg-sky-500 dark:bg-sky-400',
    glyphClass: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  },
  unlimited: {
    label: '无限额度',
    badgeClass: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
    barClass: 'bg-neutral-300 dark:bg-neutral-600',
    glyphClass: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  },
}

/** 只统计仍会拦截的额度桶：豁免 / 失效 / 被接管都不进入紧张程度。 */
export function countableQuotaBuckets(rules: QuotaBucketUsageDTO[]): QuotaBucketUsageDTO[] {
  return rules.filter((rule) => rule.limit.kind === 'amount' && !rule.invalid && !rule.shadowed)
}

export function classifyUserQuotaStatus(
  row: Pick<AdminUserQuotaDTO, 'enforcementPaused' | 'unlimited' | 'blocked' | 'rules'>,
  warnThreshold: number,
): UserQuotaFleetStatus {
  if (row.enforcementPaused) return 'paused'
  if (row.unlimited) return 'unlimited'
  if (row.blocked) return 'exhausted'
  const nearest = pickTightestQuotaBucket(countableQuotaBuckets(row.rules))
  if ((nearest?.percent ?? 0) >= warnThreshold) return 'warning'
  return 'ok'
}

export function userQuotaStatusBadge(status: UserQuotaFleetStatus): {
  label: string
  className: string
} {
  const meta = USER_QUOTA_STATUS_META[status]
  return { label: meta.label, className: meta.badgeClass }
}

export interface UserQuotaPolicyShare {
  policyId: string | null
  name: string
  count: number
  usingDefault: boolean
}

export interface UserQuotaFleetSummary {
  total: number
  limited: number
  attention: number
  counts: Record<UserQuotaFleetStatus, number>
  /** 受限额用户（含已暂停）最紧规则占用的算术平均；没有可计量规则时为 null。 */
  averageTightness: number | null
  policies: UserQuotaPolicyShare[]
  recentCostUsd: number
  recentRequests: number
}

export function summarizeUserQuotaFleet(
  users: AdminUserQuotaDTO[],
  warnThreshold: number,
  stats: UserStatDTO[] = [],
): UserQuotaFleetSummary {
  const counts: Record<UserQuotaFleetStatus, number> = {
    ok: 0,
    warning: 0,
    exhausted: 0,
    paused: 0,
    unlimited: 0,
  }
  const policyById = new Map<string, UserQuotaPolicyShare>()
  let tightnessSum = 0
  let tightnessN = 0
  let unlimitedUserCount = 0

  for (const user of users) {
    counts[classifyUserQuotaStatus(user, warnThreshold)] += 1
    const key = user.policyId ?? ''
    const existing = policyById.get(key)
    if (existing) {
      existing.count += 1
      existing.usingDefault ||= user.usingDefaultPolicy
    } else {
      policyById.set(key, {
        policyId: user.policyId,
        name: user.policyName ?? '无策略',
        count: 1,
        usingDefault: user.usingDefaultPolicy,
      })
    }
    if (user.unlimited) {
      unlimitedUserCount += 1
      continue
    }
    const tightest = pickTightestQuotaBucket(countableQuotaBuckets(user.rules))
    if (tightest?.percent == null) continue
    tightnessSum += tightest.percent
    tightnessN += 1
  }

  return {
    total: users.length,
    limited: users.length - unlimitedUserCount,
    attention: counts.exhausted + counts.warning,
    counts,
    averageTightness: tightnessN > 0 ? tightnessSum / tightnessN : null,
    policies: [...policyById.values()].sort(
      (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'),
    ),
    recentCostUsd: stats.reduce((sum, row) => sum + row.costUsd, 0),
    recentRequests: stats.reduce((sum, row) => sum + row.requests, 0),
  }
}

export function userMatchesQuotaOverviewFilter(
  row: AdminUserQuotaDTO,
  filter: UserQuotaOverviewFilter | null,
  warnThreshold: number,
): boolean {
  if (!filter) return true
  if (filter.type === 'status') return classifyUserQuotaStatus(row, warnThreshold) === filter.status
  return (row.policyId ?? null) === filter.policyId
}

export function describeQuotaOverviewFilterWithName(
  filter: UserQuotaOverviewFilter,
  policies: UserQuotaPolicyShare[],
): string {
  if (filter.type === 'status') return USER_QUOTA_STATUS_META[filter.status].label
  return policies.find((policy) => (policy.policyId ?? null) === filter.policyId)?.name ?? '无策略'
}

export interface UserQuotaUsageRankRow {
  user: AdminUserQuotaDTO
  status: UserQuotaFleetStatus
  costUsd: number
  requests: number
  share: number
}

/**
 * 用量排行必须走分析接口的可比时间窗：无限额度用户的快照没有计量桶，
 * 不能用额度 used 相加冒充「谁用得多」。
 */
export function rankUsersByRecentUsage(
  users: AdminUserQuotaDTO[],
  stats: UserStatDTO[],
  warnThreshold: number,
  limit = QUOTA_OVERVIEW_RANK_LIMIT,
): UserQuotaUsageRankRow[] {
  const userById = new Map(users.map((user) => [user.userId, user]))
  const ranked = stats
    .flatMap((stat) => {
      const user = userById.get(stat.userId)
      if (!user || (stat.costUsd <= 0 && stat.requests <= 0)) return []
      return [{ user, stat }]
    })
    .sort(
      (left, right) =>
        right.stat.costUsd - left.stat.costUsd ||
        right.stat.requests - left.stat.requests ||
        left.user.username.localeCompare(right.user.username, 'zh-CN'),
    )
    .slice(0, limit)

  const maxCost = Math.max(0, ...ranked.map((row) => row.stat.costUsd))
  const maxRequests = Math.max(0, ...ranked.map((row) => row.stat.requests))

  return ranked.map(({ user, stat }) => ({
    user,
    status: classifyUserQuotaStatus(user, warnThreshold),
    costUsd: stat.costUsd,
    requests: stat.requests,
    share: maxCost > 0 ? stat.costUsd / maxCost : maxRequests > 0 ? stat.requests / maxRequests : 0,
  }))
}

export interface UserQuotaPressureRankRow {
  user: AdminUserQuotaDTO
  status: UserQuotaFleetStatus
  tightest: QuotaBucketUsageDTO
  title: string
  detail: string
}

/** 最接近上限：只看当前额度快照里真正在计量的桶，按紧张程度排序。 */
export function rankUsersByQuotaPressure(
  users: AdminUserQuotaDTO[],
  warnThreshold: number,
  limit = QUOTA_OVERVIEW_RANK_LIMIT,
): UserQuotaPressureRankRow[] {
  return users
    .flatMap((user) => {
      const tightest = pickTightestQuotaBucket(countableQuotaBuckets(user.rules))
      if (!tightest || tightest.percent == null || (tightest.percent <= 0 && !tightest.blocked)) {
        return []
      }
      return [
        {
          user,
          status: classifyUserQuotaStatus(user, warnThreshold),
          tightest,
          title: describeQuotaRuleGroupTitle([tightest]),
          detail: `${describeQuotaWindow(tightest.window)} · ${formatQuotaAmount(tightest.metric, tightest.used)} / ${formatQuotaAmount(tightest.metric, tightest.effectiveLimit ?? 0)}`,
        },
      ]
    })
    .sort((left, right) => {
      if (left.tightest.blocked !== right.tightest.blocked) return left.tightest.blocked ? -1 : 1
      return (
        (right.tightest.percent ?? 0) - (left.tightest.percent ?? 0) ||
        left.user.username.localeCompare(right.user.username, 'zh-CN')
      )
    })
    .slice(0, limit)
}

export function quotaOverviewRangeLabel(rangeKey: QuotaOverviewRangeKey): string {
  return QUOTA_OVERVIEW_RANGES.find((range) => range.key === rangeKey)?.label ?? '7 天'
}
