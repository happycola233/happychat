import { clsx } from 'clsx'
import { Clock3, Gift, Infinity as InfinityIcon } from 'lucide-react'
import type { QuotaBucketUsageDTO } from '@shared/types/api'
import {
  describeQuotaRuleGroupTitle,
  formatQuotaAmount,
  formatQuotaLimit,
  formatQuotaTargetLabels,
  groupQuotaBucketsByRule,
  QUOTA_METRIC_LABELS,
} from '@shared/util/quota'
import { formatQuotaTimestamp, quotaPeriodCopy } from './userQuotaDisplay'

const SOURCE_LABELS: Record<QuotaBucketUsageDTO['source'], string> = {
  policy: '策略规则',
  override: '用户覆写',
  user: '专属规则',
}

function targetLabel(rule: QuotaBucketUsageDTO): string {
  if (rule.bucketLabel) return rule.bucketLabel
  if (rule.scope.type === 'all') return '全部模型'
  const count =
    rule.scope.type === 'models' ? rule.scope.modelIds.length : rule.scope.groupIds.length
  const noun = rule.scope.type === 'models' ? '模型' : '分组'
  return `${count} 个${noun}${rule.scope.mode === 'shared' ? '共享' : '各自独立'}`
}

interface StatusBadge {
  label: string
  title?: string
  className: string
}

function bucketStatus(rule: QuotaBucketUsageDTO, warnThreshold: number): StatusBadge {
  if (rule.invalid) {
    return {
      label: '已失效',
      title: '规则指向的模型或分组已不存在，不计量也不拦截',
      className: 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-200',
    }
  }
  if (rule.shadowed) {
    return {
      label: '已被接管',
      title: '这个额度桶已由更高优先级规则接管，不计量也不拦截',
      className: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
    }
  }
  if (rule.limit.kind === 'unlimited') {
    return {
      label: '豁免',
      className: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
    }
  }
  if (!rule.periodActive) {
    return {
      label: '未开始',
      className: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    }
  }
  if (rule.blocked) {
    return {
      label: '已耗尽',
      className: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
    }
  }
  if ((rule.percent ?? 0) >= warnThreshold) {
    return {
      label: '接近上限',
      className: 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-200',
    }
  }
  return {
    label: '正常',
    className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  }
}

function groupStatus(buckets: QuotaBucketUsageDTO[], warnThreshold: number): StatusBadge {
  const active = buckets.filter((bucket) => !bucket.invalid && !bucket.shadowed)
  if (buckets.every((bucket) => bucket.invalid)) return bucketStatus(buckets[0]!, warnThreshold)
  if (active.length === 0) return bucketStatus(buckets[0]!, warnThreshold)
  const blocked = active.filter((bucket) => bucket.blocked)
  if (blocked.length > 0 && blocked.length < active.length) {
    return {
      label: '部分耗尽',
      title: '这条各自独立规则里，部分目标已经用尽',
      className: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
    }
  }
  if (blocked.length === active.length) return bucketStatus(blocked[0]!, warnThreshold)
  const warning = active.find((bucket) => (bucket.percent ?? 0) >= warnThreshold)
  if (warning) return bucketStatus(warning, warnThreshold)
  return bucketStatus(active[0]!, warnThreshold)
}

function progressTone(rule: QuotaBucketUsageDTO, warnThreshold: number): string {
  if (rule.blocked) return 'bg-rose-500 dark:bg-rose-400'
  if ((rule.percent ?? 0) >= warnThreshold) return 'bg-amber-500 dark:bg-amber-400'
  return 'bg-sky-500 dark:bg-sky-400'
}

function periodsAlign(buckets: QuotaBucketUsageDTO[]): boolean {
  const first = buckets[0]
  if (!first) return true
  return buckets.every(
    (bucket) =>
      bucket.periodActive === first.periodActive &&
      bucket.periodStart === first.periodStart &&
      bucket.periodEnd === first.periodEnd &&
      bucket.usageStart === first.usageStart,
  )
}

function StatusChip({ status }: { status: StatusBadge }) {
  return (
    <span
      title={status.title}
      className={clsx('shrink-0 rounded px-1.5 py-px text-[10px] font-medium', status.className)}
    >
      {status.label}
    </span>
  )
}

function UsageCell({ rule, warnThreshold }: { rule: QuotaBucketUsageDTO; warnThreshold: number }) {
  const unlimited = rule.limit.kind === 'unlimited'
  const percentage = Math.max(0, Math.round((rule.percent ?? 0) * 100))
  return (
    <div role="cell" className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums">
        {unlimited ? (
          <span className="inline-flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
            <InfinityIcon className="h-3.5 w-3.5" /> 无限额度
          </span>
        ) : (
          <span className="truncate text-neutral-600 dark:text-neutral-300">
            {formatQuotaAmount(rule.metric, rule.used)}
            <span className="text-neutral-300 dark:text-neutral-600"> / </span>
            {formatQuotaAmount(rule.metric, rule.effectiveLimit ?? 0)}
          </span>
        )}
        {!unlimited && (
          <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{percentage}%</span>
        )}
      </div>
      {!unlimited && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div
            className={clsx('h-full rounded-full', progressTone(rule, warnThreshold))}
            style={{
              width: `${Math.min(100, Math.max(percentage > 0 ? 2 : 0, percentage))}%`,
            }}
          />
        </div>
      )}
      {rule.granted > 0 && (
        <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
          <Gift className="h-3 w-3" />
          临时 +{formatQuotaAmount(rule.metric, rule.granted)}
        </div>
      )}
    </div>
  )
}

function PeriodCell({ rule, timezone }: { rule: QuotaBucketUsageDTO; timezone: string }) {
  const period = quotaPeriodCopy(rule, timezone)
  return (
    <div
      role="cell"
      className="flex min-w-0 gap-2 text-[11px] md:col-span-2 xl:col-span-1 xl:block"
      title={`周期时间按 ${timezone} 显示`}
    >
      <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500 xl:hidden" />
      <div className="min-w-0">
        <div className="font-medium text-neutral-600 dark:text-neutral-300">{period.headline}</div>
        <div className="mt-0.5 text-neutral-400 dark:text-neutral-500">{period.detail}</div>
        {rule.limit.kind !== 'unlimited' &&
          rule.periodActive &&
          rule.usageStart > rule.periodStart && (
            <div className="mt-0.5 text-sky-600 dark:text-sky-300">
              计量起点：{formatQuotaTimestamp(rule.usageStart, timezone)}（管理员已重置）
            </div>
          )}
      </div>
    </div>
  )
}

function ruleMetadata(rule: QuotaBucketUsageDTO, options?: { includeTarget?: boolean }): string {
  const count =
    rule.scope.type === 'models'
      ? rule.scope.modelIds.length
      : rule.scope.type === 'groups'
        ? rule.scope.groupIds.length
        : null
  const noun = rule.scope.type === 'groups' ? '分组' : '模型'
  const targets = formatQuotaTargetLabels(rule.targetLabels)
  return [
    // 标题已是自定义备注时，独立桶补上目标名；共享池用 targetLabels，避免再写一遍「N 个共享」。
    ...(options?.includeTarget && rule.label && rule.bucketLabel ? [rule.bucketLabel] : []),
    ...(targets ? [targets] : []),
    ...(count && rule.scope.type !== 'all'
      ? [`${count} 个${noun}${rule.scope.mode === 'shared' ? '共享' : '各自独立'}`]
      : []),
    QUOTA_METRIC_LABELS[rule.metric],
    SOURCE_LABELS[rule.source],
    ...(rule.priority > 0 ? [`优先 ${rule.priority}`] : []),
  ].join(' · ')
}

function QuotaBucketRow({
  rule,
  warnThreshold,
  timezone,
  title,
  metadata,
}: {
  rule: QuotaBucketUsageDTO
  warnThreshold: number
  timezone: string
  title?: string
  metadata?: string
}) {
  const status = bucketStatus(rule, warnThreshold)
  const rowTitle = title ?? (rule.label || targetLabel(rule))
  const rowMeta = metadata ?? ruleMetadata(rule, { includeTarget: Boolean(rule.label) })
  return (
    <div
      role="row"
      className="grid gap-x-5 gap-y-2 py-2.5 md:grid-cols-[minmax(11rem,0.9fr)_minmax(12rem,0.9fr)] xl:grid-cols-[minmax(12rem,0.8fr)_minmax(13rem,0.8fr)_minmax(20rem,1.4fr)] xl:items-center"
    >
      <div role="cell" className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            title={rowTitle}
            className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-100"
          >
            {rowTitle}
          </span>
          <StatusChip status={status} />
        </div>
        <div
          title={rowMeta}
          className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-neutral-500"
        >
          {rowMeta}
        </div>
      </div>
      <UsageCell rule={rule} warnThreshold={warnThreshold} />
      <PeriodCell rule={rule} timezone={timezone} />
    </div>
  )
}

function IndependentQuotaGroup({
  buckets,
  warnThreshold,
  timezone,
}: {
  buckets: QuotaBucketUsageDTO[]
  warnThreshold: number
  timezone: string
}) {
  const first = buckets[0]!
  const status = groupStatus(buckets, warnThreshold)
  const aligned = periodsAlign(buckets)
  const groupTitle = describeQuotaRuleGroupTitle(buckets)
  const groupMeta = ruleMetadata(first)
  return (
    <div className="py-2.5">
      <div
        role="row"
        className="grid gap-x-5 gap-y-2 md:grid-cols-[minmax(11rem,0.9fr)_minmax(12rem,0.9fr)] xl:grid-cols-[minmax(12rem,0.8fr)_minmax(13rem,0.8fr)_minmax(20rem,1.4fr)] xl:items-center"
      >
        <div role="cell" className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span
              title={groupTitle}
              className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-100"
            >
              {groupTitle}
            </span>
            <StatusChip status={status} />
          </div>
          <div
            title={groupMeta}
            className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-neutral-500"
          >
            {groupMeta}
          </div>
        </div>
        <div role="cell" className="text-[11px] text-neutral-500 dark:text-neutral-400">
          各自独立 · 每项 {formatQuotaLimit(first.metric, first.limit)}
        </div>
        {aligned ? <PeriodCell rule={first} timezone={timezone} /> : <div role="cell" />}
      </div>

      <div className="mt-2 space-y-2 border-l border-neutral-200 pl-3 dark:border-neutral-700">
        {buckets.map((rule) => (
          <div
            key={`${rule.ruleId}:${rule.bucketKey ?? ''}`}
            role="row"
            className="grid gap-x-5 gap-y-2 md:grid-cols-[minmax(11rem,0.9fr)_minmax(12rem,0.9fr)] xl:grid-cols-[minmax(12rem,0.8fr)_minmax(13rem,0.8fr)_minmax(20rem,1.4fr)] xl:items-center"
          >
            <div role="cell" className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  title={rule.bucketLabel ?? '未命名目标'}
                  className="truncate text-xs text-neutral-700 dark:text-neutral-200"
                >
                  {rule.bucketLabel ?? '未命名目标'}
                </span>
                <StatusChip status={bucketStatus(rule, warnThreshold)} />
              </div>
            </div>
            <UsageCell rule={rule} warnThreshold={warnThreshold} />
            {aligned ? <div role="cell" /> : <PeriodCell rule={rule} timezone={timezone} />}
          </div>
        ))}
      </div>
    </div>
  )
}

export function UserQuotaBuckets({
  rules,
  warnThreshold,
  timezone,
}: {
  rules: QuotaBucketUsageDTO[]
  warnThreshold: number
  timezone: string
}) {
  const groups = groupQuotaBucketsByRule(rules)
  return (
    <div role="table" aria-label={`全部额度，共 ${groups.length} 条`} className="mt-3">
      <div
        role="row"
        className="grid grid-cols-[1fr_auto] gap-x-5 border-b border-neutral-100 pb-2 text-[10px] font-medium tracking-wide text-neutral-400 dark:border-neutral-800 dark:text-neutral-500 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(13rem,0.8fr)_minmax(20rem,1.4fr)]"
      >
        <span role="columnheader">
          全部额度 <span className="ml-1 tabular-nums">· {groups.length} 条</span>
        </span>
        <span role="columnheader" className="hidden xl:block">
          已用 / 当前上限
        </span>
        <span role="columnheader" className="hidden xl:block">
          周期与重置
        </span>
      </div>
      {groups.length === 0 ? (
        <div role="row">
          <div
            role="cell"
            className="flex items-center gap-2 py-3 text-xs text-neutral-500 dark:text-neutral-400"
          >
            <InfinityIcon className="h-3.5 w-3.5" /> 当前没有额度规则，账号为无限额度
          </div>
        </div>
      ) : (
        <div role="rowgroup" className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {groups.map((group) =>
            group.buckets.length > 1 ? (
              <IndependentQuotaGroup
                key={group.ruleId}
                buckets={group.buckets}
                warnThreshold={warnThreshold}
                timezone={timezone}
              />
            ) : (
              <QuotaBucketRow
                key={group.ruleId}
                rule={group.buckets[0]!}
                warnThreshold={warnThreshold}
                timezone={timezone}
                title={describeQuotaRuleGroupTitle(group.buckets)}
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}
