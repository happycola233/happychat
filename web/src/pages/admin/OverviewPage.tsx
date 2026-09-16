import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowUpRight, Boxes, Gauge, Users } from 'lucide-react'
import type { UsageResult } from '@shared/types/domain'
import { getOverview } from '../../api/admin'
import { HealthTimeline } from '../../components/charts'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { rangeToFilter } from '../../lib/dateRange'
import {
  formatCompact,
  formatDuration,
  formatInt,
  formatPercent,
  formatUsd,
} from '../../lib/format'
import {
  comparisonLabel,
  dashboardHref,
  fillTimeBuckets,
  readDashboardFilters,
} from './dashboardData'
import {
  DashboardError,
  DashboardLoading,
  DashboardPanel,
  MetricStrip,
  RefreshButton,
} from './DashboardPrimitives'
import { REQUEST_RESULT_LABELS } from './requestOutcome'

const OUTCOME_COLORS: Record<UsageResult, string> = {
  completed: 'bg-emerald-500',
  incomplete: 'bg-amber-400',
  refused: 'bg-orange-400',
  filtered: 'bg-violet-400',
  failed: 'bg-rose-500',
  canceled: 'bg-neutral-400',
  interrupted: 'bg-slate-500',
}
const QUICK_LINKS = [
  { to: '/admin/auth-center', label: '账号中心', description: '账号与邀请码', icon: Users },
  { to: '/admin/models', label: '模型管理', description: '接入、定价与权限', icon: Boxes },
  { to: '/admin/quotas', label: '用户限额', description: '额度与使用策略', icon: Gauge },
  { to: '/admin/error-logs', label: '错误日志', description: '定位请求异常', icon: Activity },
]

export default function OverviewPage() {
  const [params, setParams] = useSearchParams()
  const { rangeKey } = readDashboardFilters(params)
  const query = useQuery({
    queryKey: ['admin', 'overview', rangeKey],
    queryFn: () => getOverview(rangeToFilter(rangeKey)),
    refetchInterval: 60_000,
  })
  const overview = query.data
  const totals = overview?.totals
  const now = query.dataUpdatedAt || Date.now()
  const timeline = overview
    ? fillTimeBuckets(
        overview.healthTimeline,
        overview.bucket,
        rangeToFilter(rangeKey, now).from,
        now,
        { requests: 0, errors: 0 },
      )
    : []
  const eventHref = (result = '') => dashboardHref('request-events', { range: rangeKey, result })
  const change = (key: 'requests' | 'tokens' | 'costUsd' | 'activeUsers') =>
    overview?.previous && totals
      ? comparisonLabel(totals[key], overview.previous[key])
      : '全部时间累计'

  return (
    <div className="space-y-5">
      <PageHeader
        title="概览"
        description="用量、请求状态与站点运行一览。"
        actions={
          <>
            <DateRangePicker
              value={rangeKey}
              onChange={(range) => setParams({ range }, { replace: true })}
            />
            <RefreshButton busy={query.isFetching} onClick={() => void query.refetch()} />
          </>
        }
      />
      {query.isError && (
        <DashboardError hasData={!!overview} onRetry={() => void query.refetch()} />
      )}
      {query.isLoading ? (
        <DashboardLoading />
      ) : totals && overview ? (
        <>
          <MetricStrip
            items={[
              { label: '请求总数', value: formatInt(totals.requests), hint: change('requests') },
              {
                label: 'Token 用量',
                value: <span title={formatInt(totals.tokens)}>{formatCompact(totals.tokens)}</span>,
                hint: change('tokens'),
              },
              {
                label: '预估成本 · USD',
                value: formatUsd(totals.costUsd),
                hint: change('costUsd'),
              },
              {
                label: '活跃用户',
                value: formatInt(totals.activeUsers),
                hint: change('activeUsers'),
              },
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]">
            <DashboardPanel
              title="请求趋势"
              description={
                overview.bucket === 'day'
                  ? '按 UTC 日汇总 · 包含对话与标题总结'
                  : '按 UTC 小时汇总 · 包含对话与标题总结'
              }
              actions={
                <Link
                  className="inline-flex min-h-8 items-center gap-1 text-xs text-sky-700 hover:underline dark:text-sky-400"
                  to={eventHref()}
                >
                  请求明细
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              }
            >
              {totals.requests ? (
                <>
                  <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                    <div>
                      <span className="text-xl font-semibold tabular-nums">
                        {formatPercent(totals.successRate)}
                      </span>
                      <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                        非失败率
                      </span>
                    </div>
                    <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                      <i className="h-2 w-2 rounded-sm bg-emerald-500" />
                      非失败
                      <i className="ml-3 h-2 w-2 rounded-sm bg-rose-500" />
                      失败（含拒绝、过滤）
                    </span>
                  </div>
                  <HealthTimeline
                    data={timeline}
                    bucket={overview.bucket}
                    height={206}
                    timeZone="UTC"
                  />
                </>
              ) : (
                <EmptyState title="此时段暂无请求，开始使用模型后即可查看趋势。" />
              )}
              <p className="mt-3 text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">
                截断、取消与中断不计为上游失败；完整结果可在请求结果中查看。
              </p>
            </DashboardPanel>
            <DashboardPanel title="请求结果" description="选择结果，查看对应请求">
              <div
                className="mb-3 flex h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
                aria-hidden
              >
                {(Object.keys(OUTCOME_COLORS) as UsageResult[]).map((result) => (
                  <div
                    key={result}
                    className={OUTCOME_COLORS[result]}
                    style={{
                      width: `${totals.requests ? ((overview.outcomes.find((item) => item.result === result)?.count ?? 0) / totals.requests) * 100 : 0}%`,
                    }}
                  />
                ))}
              </div>
              <div className="space-y-0.5">
                {(Object.keys(OUTCOME_COLORS) as UsageResult[]).map((result) => {
                  const count = overview.outcomes.find((item) => item.result === result)?.count ?? 0
                  return (
                    <Link
                      key={result}
                      to={eventHref(result)}
                      className="flex min-h-8 items-center gap-2 rounded-md px-1 text-xs transition hover:bg-neutral-100 focus-visible:outline-sky-500 dark:hover:bg-neutral-800"
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${OUTCOME_COLORS[result]}`} />
                      <span className="flex-1">{REQUEST_RESULT_LABELS[result]}</span>
                      <span className="font-medium tabular-nums">{formatInt(count)}</span>
                      <span className="w-14 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                        {totals.requests ? formatPercent(count / totals.requests) : '—'}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </DashboardPanel>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DashboardPanel title="效率与负载" description="平均耗时仅统计有记录的请求">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                {[
                  [
                    '平均首字',
                    totals.avgFirstTokenLatencyMs == null
                      ? '—'
                      : formatDuration(totals.avgFirstTokenLatencyMs),
                  ],
                  [
                    '平均总耗时',
                    totals.avgDurationMs == null ? '—' : formatDuration(totals.avgDurationMs),
                  ],
                  ['缓存读取率', totals.requests ? formatPercent(totals.cacheRate) : '—'],
                  [
                    '平均单次成本',
                    totals.requests ? formatUsd(totals.costUsd / totals.requests) : '—',
                  ],
                  [
                    'RPM · 近 60 分钟',
                    totals.rpm.toLocaleString('zh-CN', { maximumFractionDigits: 2 }),
                  ],
                  [
                    'TPM · 近 60 分钟',
                    formatCompact(totals.tpm),
                    totals.tpm.toLocaleString('zh-CN', { maximumFractionDigits: 2 }),
                  ],
                ].map(([label, value, exact]) => (
                  <div key={label}>
                    <dt className="text-xs text-neutral-500 dark:text-neutral-400">{label}</dt>
                    <dd
                      title={exact ?? value}
                      className="mt-1.5 text-base font-semibold tabular-nums"
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </DashboardPanel>
            <DashboardPanel
              title="站点规模"
              description="当前保留的全部账号与内容"
              actions={
                <Link
                  to={dashboardHref('analytics', { range: rangeKey })}
                  className="inline-flex min-h-8 items-center gap-1 text-xs text-sky-700 hover:underline dark:text-sky-400"
                >
                  用量分析
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              }
            >
              <dl className="grid grid-cols-3 gap-3">
                {[
                  ['用户', totals.users],
                  ['会话', totals.conversations],
                  ['消息', totals.messages],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-neutral-500 dark:text-neutral-400">{label}</dt>
                    <dd
                      title={formatInt(Number(value))}
                      className="mt-2 text-xl font-semibold tabular-nums"
                    >
                      {formatCompact(Number(value))}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                成本按请求时的模型价格估算，未配置价格的用量不产生估算金额。
              </p>
            </DashboardPanel>
          </div>
          <nav aria-label="常用管理入口" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {QUICK_LINKS.map(({ to, label, description, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="group flex items-center gap-3 rounded-lg px-3 py-3 transition hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <Icon className="h-4 w-4 shrink-0 text-neutral-400 group-hover:text-sky-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{label}</div>
                  <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {description}
                  </div>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              </Link>
            ))}
          </nav>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            每分钟自动更新 · 最近更新{' '}
            {new Date(query.dataUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            {overview.previous && ' · 对比紧邻所选区间的等长上一时段'}
          </p>
        </>
      ) : null}
    </div>
  )
}
