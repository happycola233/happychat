import { clsx } from 'clsx'
import { X } from 'lucide-react'
import type { AdminUserQuotaDTO, UserStatDTO } from '@shared/types/api'
import { formatQuotaCostUsd } from '@shared/util/quota'
import { cardSurface } from '../../components/ui/Card'
import { Spinner } from '../../components/ui/Spinner'
import { formatInt } from '../../lib/format'
import { AdminUserAvatar } from './AdminUserAvatar'
import {
  QUOTA_OVERVIEW_RANGES,
  USER_QUOTA_FLEET_STATUSES,
  USER_QUOTA_STATUS_META,
  describeQuotaOverviewFilterWithName,
  quotaOverviewRangeLabel,
  rankUsersByQuotaPressure,
  rankUsersByRecentUsage,
  summarizeUserQuotaFleet,
  type QuotaOverviewRangeKey,
  type UserQuotaFleetStatus,
  type UserQuotaOverviewFilter,
  type UserQuotaPressureRankRow,
  type UserQuotaUsageRankRow,
} from './quotaOverview'

function toggleFilter(
  current: UserQuotaOverviewFilter | null,
  next: UserQuotaOverviewFilter,
): UserQuotaOverviewFilter | null {
  if (
    current &&
    current.type === next.type &&
    (current.type === 'status'
      ? current.status === (next as { status: UserQuotaFleetStatus }).status
      : current.policyId === (next as { policyId: string | null }).policyId)
  ) {
    return null
  }
  return next
}

function RankBar({ share, tone }: { share: number; tone: string }) {
  const width = Math.min(100, Math.max(share > 0 ? 4 : 0, Math.round(share * 100)))
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
      <div className={clsx('h-full rounded-full', tone)} style={{ width: `${width}%` }} />
    </div>
  )
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone?: 'rose' | 'amber' | 'ok'
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] font-medium tracking-wide text-neutral-400 dark:text-neutral-500">
        {label}
      </div>
      <div
        className={clsx(
          'mt-1.5 text-2xl font-semibold tracking-tight tabular-nums',
          tone === 'rose'
            ? 'text-rose-600 dark:text-rose-300'
            : tone === 'amber'
              ? 'text-amber-600 dark:text-amber-200'
              : 'text-neutral-900 dark:text-neutral-50',
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-neutral-400 dark:text-neutral-500">{hint}</div>
    </div>
  )
}

function UsageRow({
  rank,
  row,
  onSelect,
}: {
  rank: number
  row: UserQuotaUsageRankRow
  onSelect: (userId: string) => void
}) {
  const meta = USER_QUOTA_STATUS_META[row.status]
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.user.userId)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:hover:bg-neutral-800/70"
      >
        <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-neutral-400">
          {rank}
        </span>
        <AdminUserAvatar
          username={row.user.username}
          displayName={row.user.displayName}
          avatarUrl={row.user.avatarUrl}
          className="h-8 w-8 text-xs"
          fallbackClassName={USER_QUOTA_STATUS_META[row.status].glyphClass}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
              {row.user.username}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-800 dark:text-neutral-100">
              {formatQuotaCostUsd(row.costUsd)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-3 text-[11px] text-neutral-400 dark:text-neutral-500">
            <span className="truncate">
              {formatInt(row.requests)} 次
              {row.user.disabled ? ' · 已停用' : ''}
            </span>
            <span className={clsx('shrink-0 rounded px-1.5 py-px font-medium', meta.badgeClass)}>
              {meta.label}
            </span>
          </div>
          <div className="mt-1.5">
            <RankBar share={row.share} tone="bg-sky-500 dark:bg-sky-400" />
          </div>
        </div>
      </button>
    </li>
  )
}

function PressureRow({
  rank,
  row,
  onSelect,
}: {
  rank: number
  row: UserQuotaPressureRankRow
  onSelect: (userId: string) => void
}) {
  const percent = Math.max(0, Math.round((row.tightest.percent ?? 0) * 100))
  const tone =
    row.tightest.blocked || row.status === 'exhausted'
      ? 'bg-rose-500 dark:bg-rose-400'
      : row.status === 'warning'
        ? 'bg-amber-500 dark:bg-amber-400'
        : 'bg-sky-500 dark:bg-sky-400'
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.user.userId)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:hover:bg-neutral-800/70"
      >
        <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-neutral-400">
          {rank}
        </span>
        <AdminUserAvatar
          username={row.user.username}
          displayName={row.user.displayName}
          avatarUrl={row.user.avatarUrl}
          className="h-8 w-8 text-xs"
          fallbackClassName={USER_QUOTA_STATUS_META[row.status].glyphClass}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
              {row.user.username}
            </span>
            <span
              className={clsx(
                'shrink-0 text-sm font-semibold tabular-nums',
                row.tightest.blocked
                  ? 'text-rose-600 dark:text-rose-300'
                  : row.status === 'warning'
                    ? 'text-amber-600 dark:text-amber-200'
                    : 'text-neutral-800 dark:text-neutral-100',
              )}
            >
              {percent}%
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
            {row.title} · {row.detail}
          </div>
          <div className="mt-1.5">
            <RankBar share={Math.min(1, row.tightest.percent ?? 0)} tone={tone} />
          </div>
        </div>
      </button>
    </li>
  )
}

function EmptyRank({ children }: { children: string }) {
  return (
    <div className="flex h-36 items-center justify-center px-4 text-center text-xs leading-5 text-neutral-400 dark:text-neutral-500">
      {children}
    </div>
  )
}

/**
 * 用户视图顶部的总览：状态分布一眼可读，用量与压力分列，
 * 点状态 / 策略即可收窄下方名单。
 */
export function UserQuotaOverview({
  users,
  stats,
  statsLoading,
  rangeKey,
  onRangeKeyChange,
  warnThreshold,
  filter,
  onFilterChange,
  onSelectUser,
}: {
  users: AdminUserQuotaDTO[]
  stats: UserStatDTO[] | undefined
  statsLoading: boolean
  rangeKey: QuotaOverviewRangeKey
  onRangeKeyChange: (key: QuotaOverviewRangeKey) => void
  warnThreshold: number
  filter: UserQuotaOverviewFilter | null
  onFilterChange: (filter: UserQuotaOverviewFilter | null) => void
  onSelectUser: (userId: string) => void
}) {
  const summary = summarizeUserQuotaFleet(users, warnThreshold, stats ?? [])
  const usageRows = rankUsersByRecentUsage(users, stats ?? [], warnThreshold)
  const pressureRows = rankUsersByQuotaPressure(users, warnThreshold)
  const rangeLabel = quotaOverviewRangeLabel(rangeKey)
  const attentionTone =
    summary.counts.exhausted > 0 ? 'rose' : summary.counts.warning > 0 ? 'amber' : 'ok'
  const tightnessTone =
    summary.averageTightness == null
      ? 'ok'
      : summary.averageTightness >= 1
        ? 'rose'
        : summary.averageTightness >= warnThreshold
          ? 'amber'
          : 'ok'
  const filterLabel = filter ? describeQuotaOverviewFilterWithName(filter, summary.policies) : null
  const unlimitedUserCount = summary.total - summary.limited

  return (
    <section className={cardSurface}>
      <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">总览</h2>
            {filterLabel && (
              <button
                type="button"
                onClick={() => onFilterChange(null)}
                className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 transition hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
              >
                正在查看：{filterLabel}
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
            额度健康来自当前周期快照；用量排行是可比时间窗内的对话消耗，无限额度用户也会出现。
          </p>
        </div>
        <div
          className="inline-flex w-fit shrink-0 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800"
          role="group"
          aria-label="用量统计时间窗"
        >
          {QUOTA_OVERVIEW_RANGES.map((range) => (
            <button
              key={range.key}
              type="button"
              aria-pressed={rangeKey === range.key}
              onClick={() => onRangeKeyChange(range.key)}
              className={clsx(
                'rounded-md px-2.5 py-1 text-[12px] font-medium transition',
                rangeKey === range.key
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-600 dark:text-white'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 divide-y divide-neutral-100 border-y border-neutral-100 sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-neutral-800 dark:border-neutral-800">
        <Kpi
          label="受限额用户"
          value={`${formatInt(summary.limited)} / ${formatInt(summary.total)}`}
          hint={
            unlimitedUserCount > 0
              ? `${formatInt(unlimitedUserCount)} 人无限额度`
              : '全部用户都受策略约束'
          }
        />
        <Kpi
          label="需关注"
          value={formatInt(summary.attention)}
          hint={`${formatInt(summary.counts.exhausted)} 已耗尽 · ${formatInt(summary.counts.warning)} 接近上限`}
          tone={attentionTone}
        />
        <Kpi
          label="平均占用"
          value={
            summary.averageTightness == null
              ? '—'
              : `${Math.round(summary.averageTightness * 100)}%`
          }
          hint="受限额用户最紧一条规则"
          tone={tightnessTone}
        />
        <Kpi
          label={`近 ${rangeLabel}消费`}
          value={statsLoading && !stats ? '…' : formatQuotaCostUsd(summary.recentCostUsd)}
          hint={
            statsLoading && !stats
              ? '正在汇总对话用量'
              : `${formatInt(summary.recentRequests)} 次对话请求`
          }
        />
      </div>

      <div className="px-5 py-4">
        <div className="flex h-2.5 gap-0.5" aria-hidden>
          {summary.total === 0 ? (
            <div className="flex-1 rounded-full bg-neutral-100 dark:bg-neutral-800" />
          ) : (
            USER_QUOTA_FLEET_STATUSES.map((status) => {
              const count = summary.counts[status]
              if (count === 0) return null
              return (
                <div
                  key={status}
                  className={clsx(
                    'min-w-1.5 rounded-full transition',
                    USER_QUOTA_STATUS_META[status].barClass,
                    filter?.type === 'status' &&
                      filter.status === status &&
                      'ring-2 ring-sky-400 ring-offset-1 ring-offset-white dark:ring-offset-neutral-900',
                  )}
                  style={{ flexGrow: count }}
                />
              )
            })
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {USER_QUOTA_FLEET_STATUSES.map((status) => {
            const count = summary.counts[status]
            const active = filter?.type === 'status' && filter.status === status
            const disabled = count === 0
            return (
              <button
                key={status}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() =>
                  onFilterChange(toggleFilter(filter, { type: 'status', status }))
                }
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
                  disabled
                    ? 'cursor-default text-neutral-300 dark:text-neutral-600'
                    : active
                      ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-800'
                      : 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:bg-neutral-800',
                )}
              >
                <span
                  className={clsx(
                    'h-1.5 w-1.5 rounded-full',
                    disabled ? 'bg-neutral-300 dark:bg-neutral-600' : USER_QUOTA_STATUS_META[status].barClass,
                  )}
                />
                {USER_QUOTA_STATUS_META[status].label}
                <span className="tabular-nums">{formatInt(count)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid border-t border-neutral-100 lg:grid-cols-2 dark:border-neutral-800">
        <div className="border-b border-neutral-100 px-4 py-4 lg:border-r lg:border-b-0 dark:border-neutral-800">
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              用量最多
            </h3>
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">近 {rangeLabel}</span>
          </div>
          {statsLoading && !stats ? (
            <div className="flex h-36 items-center justify-center">
              <Spinner className="h-5 w-5 text-neutral-400" />
            </div>
          ) : usageRows.length === 0 ? (
            <EmptyRank>这个时间窗还没有对话用量</EmptyRank>
          ) : (
            <ol className="space-y-0.5">
              {usageRows.map((row, index) => (
                <UsageRow
                  key={row.user.userId}
                  rank={index + 1}
                  row={row}
                  onSelect={onSelectUser}
                />
              ))}
            </ol>
          )}
        </div>
        <div className="px-4 py-4">
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              最接近上限
            </h3>
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">当前额度周期</span>
          </div>
          {pressureRows.length === 0 ? (
            <EmptyRank>还没有人开始消耗额度</EmptyRank>
          ) : (
            <ol className="space-y-0.5">
              {pressureRows.map((row, index) => (
                <PressureRow
                  key={row.user.userId}
                  rank={index + 1}
                  row={row}
                  onSelect={onSelectUser}
                />
              ))}
            </ol>
          )}
        </div>
      </div>

      {summary.policies.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-5 py-3 dark:border-neutral-800">
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">策略</span>
          {summary.policies.map((policy) => {
            const active = filter?.type === 'policy' && filter.policyId === policy.policyId
            return (
              <button
                key={policy.policyId ?? 'none'}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onFilterChange(
                    toggleFilter(filter, { type: 'policy', policyId: policy.policyId }),
                  )
                }
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40',
                  active
                    ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-800'
                    : 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:bg-neutral-800',
                )}
              >
                {policy.name}
                {policy.usingDefault && (
                  <span className="text-neutral-400 dark:text-neutral-500">默认</span>
                )}
                <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
                  {formatInt(policy.count)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
