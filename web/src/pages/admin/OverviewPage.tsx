import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getOverview } from '../../api/admin'
import { HealthTimeline } from '../../components/charts'
import { StatCard } from '../../components/ui/StatCard'
import { Spinner } from '../../components/ui/Spinner'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { rangeToFilter, type RangeKey } from '../../lib/dateRange'
import {
  formatCompact,
  formatInt,
  formatPercent,
  formatUsd,
} from '../../lib/format'

export default function OverviewPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d')

  const { data: overview, isLoading } = useQuery({
    queryKey: ['admin', 'overview', rangeKey],
    queryFn: () => getOverview(rangeToFilter(rangeKey)),
  })

  const totals = overview?.totals
  const timeline = overview?.healthTimeline ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">概览</h1>
        <DateRangePicker value={rangeKey} onChange={setRangeKey} />
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !totals ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          暂无数据
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="请求总数" value={formatInt(totals.requests)} />
            <StatCard label="成功率" value={formatPercent(totals.successRate)} />
            <StatCard label="Token 总量" value={formatCompact(totals.tokens)} />
            <StatCard label="缓存率" value={formatPercent(totals.cacheRate)} />
            <StatCard label="RPM" value={totals.rpm.toFixed(1)} />
            <StatCard label="TPM" value={formatCompact(totals.tpm)} />
            <StatCard label="成本估算" value={formatUsd(totals.costUsd)} />
            <StatCard label="错误数" value={formatInt(totals.errors)} />
            <StatCard label="用户" value={formatInt(totals.users)} />
            <StatCard label="会话" value={formatInt(totals.conversations)} />
            <StatCard label="消息" value={formatInt(totals.messages)} />
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-200">
              请求健康
            </h2>
            {timeline.length ? (
              <HealthTimeline data={timeline} bucket={rangeKey === '24h' ? 'hour' : 'day'} />
            ) : (
              <div className="py-12 text-center text-sm text-neutral-400">暂无数据</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
