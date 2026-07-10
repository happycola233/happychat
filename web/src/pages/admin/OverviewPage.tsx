import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getOverview } from '../../api/admin'
import { HealthTimeline } from '../../components/charts'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatCard } from '../../components/ui/StatCard'
import { cardSurface } from '../../components/ui/Card'
import { Spinner } from '../../components/ui/Spinner'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { rangeToFilter, type RangeKey } from '../../lib/dateRange'
import {
  formatCompact,
  formatInt,
  formatPercent,
  formatUsd,
} from '../../lib/format'

/** 规模统计条：一张卡里用竖分隔线排布多个次级指标，比一格一卡轻得多。 */
function StatStrip({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div
      className={`${cardSurface} grid grid-cols-1 divide-y divide-neutral-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-neutral-800`}
    >
      {items.map((item) => (
        <div key={item.label} className="px-5 py-4">
          <div className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
            {item.label}
          </div>
          <div className="mt-1.5 text-xl font-semibold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}

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
      <PageHeader
        title="概览"
        actions={<DateRangePicker value={rangeKey} onChange={setRangeKey} />}
      />

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !totals ? (
        <EmptyState title="暂无数据" />
      ) : (
        <>
          {/* 核心指标：4 张带上下文小字的主卡，相关指标合并成 hint，不再一格一卡铺 11 张。 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="请求总数"
              value={formatInt(totals.requests)}
              hint={`成功率 ${formatPercent(totals.successRate)} · 错误数 ${formatInt(totals.errors)}`}
            />
            <StatCard
              label="Token 总量"
              value={formatCompact(totals.tokens)}
              hint={`缓存读取率 ${formatPercent(totals.cacheRate)}`}
            />
            <StatCard label="成本估算" value={formatUsd(totals.costUsd)} hint="按模型定价估算" />
            <StatCard
              label="RPM / TPM"
              value={`${totals.rpm.toFixed(1)} / ${formatCompact(totals.tpm)}`}
              hint="最近 60 分钟负载"
            />
          </div>

          {/* 规模统计：次级指标收进一条分隔条。 */}
          <StatStrip
            items={[
              { label: '用户', value: formatInt(totals.users) },
              { label: '会话', value: formatInt(totals.conversations) },
              { label: '消息', value: formatInt(totals.messages) },
            ]}
          />

          <div className={`${cardSurface} p-5`}>
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
