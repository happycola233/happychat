import { useState } from 'react'
import { ChartNoAxesCombined, Table2 } from 'lucide-react'
import type { UsageStatsDTO } from '@shared/types/api'
import { TrendChart } from '../components/charts'
import { Button } from '../components/ui/Button'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { formatInt } from '../lib/format'
import { UsageSection, UsageSectionFooter, UsageValue } from './UsagePrimitives'
import { formatUsageMetric, USAGE_METRICS, type UsageMetric } from './usagePresentation'

/** 请求、Token、花费分别作图，避免量级不同导致同轴曲线失真。 */
export function UsageTrendCard({
  stats,
  viewLabel,
  timeZone,
}: {
  stats: UsageStatsDTO
  viewLabel: string
  timeZone?: string
}) {
  const [metric, setMetric] = useState<UsageMetric>('requests')
  const [showTable, setShowTable] = useState(false)
  const label = USAGE_METRICS.find((item) => item.value === metric)!.label
  const bucketLabel = { hour: '小时', day: '天', month: '月' }[stats.granularity]
  const peak = stats.trend.reduce(
    (best, point) => (point[metric] > (best?.[metric] ?? 0) ? point : best),
    null as UsageStatsDTO['trend'][number] | null,
  )
  const formatBucket = (ts: number) =>
    new Date(ts).toLocaleString('zh-CN', {
      timeZone,
      month: 'numeric',
      ...(stats.granularity !== 'month' ? { day: 'numeric' } : {}),
      ...(stats.granularity === 'hour'
        ? { hour: '2-digit', minute: '2-digit', hour12: false }
        : {}),
    })
  return (
    <UsageSection
      title="用量趋势"
      description={viewLabel + ' · 按' + bucketLabel + '汇总'}
      actions={
        <SegmentedControl
          label="趋势指标"
          value={metric}
          onChange={setMetric}
          options={USAGE_METRICS}
        />
      }
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <UsageValue
          exact={formatUsageMetric(stats.totals[metric], metric, true)}
          className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100"
        >
          {formatUsageMetric(stats.totals[metric], metric)}
        </UsageValue>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {viewLabel}
          {label}
          {metric === 'costUsd' ? ' · USD' : '总量'}
        </span>
      </div>
      {showTable ? (
        <div
          className="hc-scrollbar h-[228px] overflow-auto rounded-lg"
          tabIndex={0}
          aria-label="趋势数据表"
        >
          <table className="w-full text-right text-xs tabular-nums">
            <caption className="sr-only">
              {viewLabel}每{bucketLabel}用量
            </caption>
            <thead className="sticky top-0 bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              <tr>
                {['时间', '请求', 'Token', '花费 · USD'].map((title) => (
                  <th
                    key={title}
                    scope="col"
                    className="whitespace-nowrap px-2 py-2.5 font-medium first:text-left"
                  >
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200/50 text-neutral-700 dark:divide-neutral-800 dark:text-neutral-300">
              {stats.trend.map((point) => (
                <tr key={point.ts}>
                  <th
                    scope="row"
                    className="whitespace-nowrap px-2 py-2.5 text-left font-normal"
                    title={new Date(point.ts).toISOString()}
                  >
                    {formatBucket(point.ts)}
                  </th>
                  <td className="px-2">{formatInt(point.requests)}</td>
                  <td className="px-2">{formatInt(point.totalTokens)}</td>
                  <td className="px-2">{formatUsageMetric(point.costUsd, 'costUsd', true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : stats.totals.requests === 0 ? (
        <div className="flex h-[228px] flex-col items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <ChartNoAxesCombined
            aria-hidden
            className="h-7 w-7 text-neutral-300 dark:text-neutral-600"
          />
          <p>{viewLabel}还没有用量记录</p>
          <p className="text-xs">开始对话后，可以在这里查看变化。</p>
        </div>
      ) : (
        <TrendChart
          data={stats.trend}
          series={[{ key: metric, name: label, color: '#0ea5e9' }]}
          bucket={stats.granularity}
          height={228}
          timeZone={timeZone}
          valueFormat={(value) => formatUsageMetric(value, metric)}
          tooltipValueFormat={(value) => formatUsageMetric(value, metric, true)}
          showLegend={false}
        />
      )}
      <UsageSectionFooter
        note={
          peak
            ? '峰值 ' +
              formatBucket(peak.ts) +
              ' · ' +
              formatUsageMetric(peak[metric], metric) +
              (metric === 'requests' ? ' 次' : '')
            : '暂无峰值记录'
        }
        actions={
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={showTable}
            onClick={() => setShowTable(!showTable)}
          >
            {showTable ? (
              <ChartNoAxesCombined className="h-3.5 w-3.5" />
            ) : (
              <Table2 className="h-3.5 w-3.5" />
            )}
            {showTable ? '查看图表' : '查看明细'}
          </Button>
        }
      />
    </UsageSection>
  )
}
