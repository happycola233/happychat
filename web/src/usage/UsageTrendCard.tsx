import { useState } from 'react'
import { clsx } from 'clsx'
import type { UsageStatsDTO } from '@shared/types/api'
import { formatQuotaCostUsd } from '@shared/util/quota'
import { TrendChart } from '../components/charts'
import { formatCompact, formatInt } from '../lib/format'

type Metric = 'requests' | 'totalTokens' | 'costUsd'

/** 三个测度量级差得远（次 / 万 token / 美元），同轴叠加会让小的那条贴地，所以一次只画一条。 */
const METRICS: { key: Metric; label: string; format: (value: number) => string }[] = [
  { key: 'requests', label: '请求次数', format: formatInt },
  { key: 'totalTokens', label: 'Token', format: formatCompact },
  { key: 'costUsd', label: '花费', format: formatQuotaCostUsd },
]

/** 窗口内的用量趋势；分桶粒度由服务端按窗口给出（今日按小时、本年按月）。 */
export function UsageTrendCard({ stats, viewLabel }: { stats: UsageStatsDTO; viewLabel: string }) {
  const [metric, setMetric] = useState<Metric>('requests')
  const active = METRICS.find((item) => item.key === metric)!

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          {viewLabel}趋势
        </h2>
        <div className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
          {METRICS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={metric === item.key}
              onClick={() => setMetric(item.key)}
              className={clsx(
                'rounded-md px-2 py-1 text-[11px] font-medium transition',
                metric === item.key
                  ? 'bg-white text-neutral-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {stats.trend.length === 0 ? (
        <p className="py-10 text-center text-xs text-neutral-400 dark:text-neutral-500">
          {viewLabel}还没有用量记录。
        </p>
      ) : (
        <TrendChart
          data={stats.trend.map((point) => ({ ts: point.ts, [metric]: point[metric] }))}
          series={[{ key: metric, name: active.label, color: '#0ea5e9' }]}
          bucket={stats.granularity}
          height={220}
          valueFormat={active.format}
        />
      )}
    </div>
  )
}
