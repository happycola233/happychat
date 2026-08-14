import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import type { UsageHeatmapCellDTO } from '@shared/types/api'
import { formatQuotaCostUsd } from '@shared/util/quota'
import { formatCompact, formatInt } from '../lib/format'
import { buildHeatmapGrid, type HeatmapDay, type HeatmapMetric } from './heatmapGrid'

const METRIC_OPTIONS: { value: HeatmapMetric; label: string }[] = [
  { value: 'requests', label: '请求数' },
  { value: 'tokens', label: 'Token' },
  { value: 'cost', label: '花费' },
]

const LEVEL_CLASS = ['hc-heat-0', 'hc-heat-1', 'hc-heat-2', 'hc-heat-3', 'hc-heat-4'] as const

function formatDate(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)} 月 ${Number(day)} 日`
}

/** 单格的完整读数：三个口径同时给出，切换口径时不必反复 hover。 */
function cellTitle(day: HeatmapDay): string {
  if (day.requests === 0) return `${formatDate(day.date)} · 无活动`
  return [
    formatDate(day.date),
    `请求 ${formatInt(day.requests)} 次`,
    `Token ${formatCompact(day.totalTokens)}`,
    `花费 ${formatQuotaCostUsd(day.costUsd)}`,
  ].join(' · ')
}

/**
 * GitHub 贡献图风格的活跃热力图。
 *
 * 编码口径：单色 sky 序列表示量级（0 档为中性灰＝无活动），列＝周、行＝星期。
 * 刻意不引 recharts——这张图是纯网格，自绘既省包体积又能精确控制格子尺寸与对齐。
 */
export function UsageHeatmap({ cells }: { cells: UsageHeatmapCellDTO[] }) {
  const [metric, setMetric] = useState<HeatmapMetric>('requests')
  const grid = useMemo(() => buildHeatmapGrid(cells, { metric }), [cells, metric])
  const totalLabel =
    metric === 'cost'
      ? formatQuotaCostUsd(grid.total)
      : metric === 'tokens'
        ? formatCompact(grid.total)
        : `${formatInt(grid.total)} 次`

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          近一年共 <span className="font-medium text-neutral-700 dark:text-neutral-200">{totalLabel}</span>
          ，活跃 {grid.activeDays} 天
        </div>
        {/* 口径切换：一行分段控件，放在图上方（filters in one row above the chart）。 */}
        <div
          role="group"
          aria-label="热力图口径"
          className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800"
        >
          {METRIC_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={metric === option.value}
              onClick={() => setMetric(option.value)}
              className={clsx(
                'rounded-md px-2 py-1 text-[11px] font-medium transition',
                metric === option.value
                  ? 'bg-white text-neutral-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* 横向滚动：一年 53 列在窄屏放不下，滚动比压缩格子更可读。 */}
      <div className="hc-scrollbar overflow-x-auto pb-1">
        <div className="inline-flex gap-1.5">
          {/* 行标签只显示周一/周三/周五，与 GitHub 同样避免 7 行标签把图挤窄。 */}
          <div className="flex flex-col gap-[3px] pt-[18px] pr-1">
            {grid.weekdayLabels.map((label, index) => (
              <span
                key={label}
                className="h-[11px] text-[10px] leading-[11px] text-neutral-400 dark:text-neutral-500"
              >
                {index % 2 === 0 ? label : ''}
              </span>
            ))}
          </div>
          <div>
            {/* 月份刻度 */}
            <div className="relative mb-1 h-[14px]">
              {grid.monthLabels.map((month) => (
                <span
                  key={`${month.weekIndex}-${month.label}`}
                  className="absolute text-[10px] leading-[14px] text-neutral-400 dark:text-neutral-500"
                  style={{ left: `${month.weekIndex * 14}px` }}
                >
                  {month.label}
                </span>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {grid.weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="flex flex-col gap-[3px]">
                  {week.map((day, dayIndex) =>
                    day ? (
                      <button
                        key={day.date}
                        type="button"
                        title={cellTitle(day)}
                        aria-label={cellTitle(day)}
                        className={clsx('hc-heat-cell h-[11px] w-[11px]', LEVEL_CLASS[day.level])}
                      />
                    ) : (
                      <span key={`pad-${weekIndex}-${dayIndex}`} className="h-[11px] w-[11px]" />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 图例：色阶本身就是「少 → 多」的说明，不需要数值刻度 */}
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-neutral-400 dark:text-neutral-500">
        <span>少</span>
        {LEVEL_CLASS.map((levelClass) => (
          <span key={levelClass} className={clsx('hc-heat-cell h-[10px] w-[10px]', levelClass)} />
        ))}
        <span>多</span>
      </div>
    </div>
  )
}
