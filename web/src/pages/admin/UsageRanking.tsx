import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { UsageBreakdownDTO } from '@shared/types/api'
import { EmptyState } from '../../components/ui/EmptyState'
import { Select } from '../../components/ui/Select'
import { formatCompact, formatInt, formatPercent, formatUsd } from '../../lib/format'
import { DashboardPanel } from './DashboardPrimitives'

type Metric = 'costUsd' | 'requests' | 'totalTokens'
const FORMATS = { costUsd: formatUsd, requests: formatInt, totalTokens: formatCompact }

export function UsageRanking({
  title,
  rows,
  onSelect,
}: {
  title: string
  rows: UsageBreakdownDTO[]
  onSelect: (id: string) => void
}) {
  const [metric, setMetric] = useState<Metric>('costUsd')
  const [expanded, setExpanded] = useState(false)
  const sorted = [...rows].sort((a, b) => b[metric] - a[metric] || b.requests - a.requests)
  const total = rows.reduce((sum, row) => sum + row[metric], 0)
  const visible = expanded ? sorted : sorted.slice(0, 5)
  return (
    <DashboardPanel
      title={title}
      description={`共 ${rows.length} 项 · 选择名称可筛选`}
      actions={
        <Select
          aria-label={`${title}排序`}
          className="w-24"
          value={metric}
          onChange={(event) => setMetric(event.target.value as Metric)}
          options={[
            { value: 'costUsd', label: '按成本' },
            { value: 'requests', label: '按请求' },
            { value: 'totalTokens', label: '按 Token' },
          ]}
        />
      }
    >
      {!rows.length ? (
        <EmptyState title="此时段暂无用量" />
      ) : (
        <>
          <ol className="space-y-3">
            {visible.map((row, index) => (
              <li key={row.key}>
                <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs">
                  <span className="w-4 shrink-0 tabular-nums text-neutral-400">{index + 1}</span>
                  {row.id ? (
                    <button
                      type="button"
                      onClick={() => onSelect(row.id!)}
                      className="group flex min-h-7 min-w-0 flex-1 items-center gap-1 text-left hover:text-sky-600 focus-visible:outline-sky-500 dark:hover:text-sky-400"
                    >
                      <span className="truncate" title={row.label}>
                        {row.label}
                      </span>
                      <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate" title={row.label}>
                      {row.label}
                      <span className="ml-1 text-neutral-500">（已删除）</span>
                    </span>
                  )}
                  <span
                    title={
                      metric === 'costUsd'
                        ? `$${row[metric].toLocaleString('en-US', { maximumFractionDigits: 6 })}`
                        : formatInt(row[metric])
                    }
                    className="shrink-0 font-medium tabular-nums"
                  >
                    {FORMATS[metric](row[metric])}
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                    {total ? formatPercent(row[metric] / total) : '—'}
                  </span>
                </div>
                <div
                  aria-hidden
                  className="ml-6 h-1 rounded-full bg-neutral-200/70 dark:bg-neutral-800"
                >
                  <div
                    className="h-full rounded-full bg-sky-500/70 dark:bg-sky-400/70"
                    style={{ width: `${total ? (row[metric] / total) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
          {rows.length > 5 && (
            <button
              type="button"
              className="mt-3 min-h-8 text-xs text-sky-700 hover:underline dark:text-sky-400"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起排行' : `查看全部 ${rows.length} 项`}
            </button>
          )}
        </>
      )}
    </DashboardPanel>
  )
}
