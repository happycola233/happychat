import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react'
import type { UsageHeatmapCellDTO } from '@shared/types/api'
import { Button } from '../components/ui/Button'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { inputClass } from '../components/ui/controlStyles'
import { formatInt } from '../lib/format'
import { buildHeatmapGrid, type HeatmapDay, type HeatmapMetric } from './heatmapGrid'
import { UsageSection } from './UsagePrimitives'
import { formatUsageMetric } from './usagePresentation'

const METRIC_OPTIONS: { value: HeatmapMetric; label: string }[] = [
  { value: 'requests', label: '请求' },
  { value: 'tokens', label: 'Token' },
  { value: 'cost', label: '花费' },
]
const LEVEL_CLASS = ['hc-heat-0', 'hc-heat-1', 'hc-heat-2', 'hc-heat-3', 'hc-heat-4'] as const

function cellTitle(day: HeatmapDay): string {
  return (
    day.date +
    ' · ' +
    formatInt(day.requests) +
    ' 次请求 · ' +
    formatInt(day.totalTokens) +
    ' Token · ' +
    formatUsageMetric(day.costUsd, 'costUsd', true)
  )
}

/** 全年日历保留独立时间范围；同一份读数支持指针预览、触屏选择与键盘导航。 */
export function UsageHeatmap({
  cells,
  currentStreak,
  longestStreak,
}: {
  cells: UsageHeatmapCellDTO[]
  currentStreak: number
  longestStreak: number
}) {
  const [metric, setMetric] = useState<HeatmapMetric>('requests')
  const [selectedDate, setSelectedDate] = useState(cells.at(-1)?.date ?? '')
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const grid = useMemo(() => buildHeatmapGrid(cells, { metric }), [cells, metric])
  const selectedIndex = Math.max(
    0,
    cells.findIndex((day) => day.date === selectedDate),
  )
  const selected = cells[selectedIndex]
  const inspected = cells.find((day) => day.date === hoveredDate) ?? selected
  const gridTemplateColumns = '2rem repeat(' + grid.weeks.length + ', minmax(14px, 1fr))'

  // 窄屏首次打开即看到最近的活动；切换口径和点选日期不重置用户滚动位置。
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    let previousWidth = 0
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== previousWidth) {
        previousWidth = node.clientWidth
        node.scrollLeft = node.scrollWidth
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const selectDay = (index: number, focus = false) => {
    const day = cells[Math.max(0, Math.min(cells.length - 1, index))]
    if (!day) return
    setSelectedDate(day.date)
    setHoveredDate(null)
    const button = scrollRef.current?.querySelector<HTMLButtonElement>(
      '[data-date="' + day.date + '"]',
    )
    if (focus) button?.focus({ preventScroll: true })
    // 只移动图内的横向滚动，不把整个页面拖到日历处。
    const container = scrollRef.current
    if (button && container) {
      const box = button.getBoundingClientRect()
      const bounds = container.getBoundingClientRect()
      if (box.left < bounds.left) container.scrollLeft += box.left - bounds.left - 4
      else if (box.right > bounds.right) container.scrollLeft += box.right - bounds.right + 4
    }
  }

  return (
    <UsageSection
      id="usage-activity"
      title="活跃记录"
      description="近一年 · 每格代表一天"
      actions={
        <SegmentedControl
          label="热力图口径"
          value={metric}
          options={METRIC_OPTIONS}
          onChange={setMetric}
        />
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          活跃{' '}
          <strong className="font-semibold text-neutral-800 dark:text-neutral-200">
            {grid.activeDays}
          </strong>{' '}
          天
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Flame aria-hidden className="h-3.5 w-3.5 text-orange-500" />
          连续 {currentStreak} 天
        </span>
        <span>最长连续 {longestStreak} 天</span>
        <span className="sm:ml-auto">
          累计{' '}
          {metric === 'cost'
            ? formatUsageMetric(grid.total, 'costUsd')
            : metric === 'tokens'
              ? formatUsageMetric(grid.total, 'totalTokens') + ' Token'
              : formatInt(grid.total) + ' 次请求'}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="hc-scrollbar overflow-x-auto p-1 pb-2"
        onPointerLeave={() => setHoveredDate(null)}
      >
        <div className="min-w-[920px]">
          <div
            className="mb-2 grid gap-[3px] text-[11px] text-neutral-500 dark:text-neutral-400"
            style={{ gridTemplateColumns }}
            aria-hidden
          >
            {grid.monthLabels.map((month) => (
              <span
                key={month.weekIndex}
                style={{ gridColumn: month.weekIndex + 2, gridRow: 1 }}
                className="whitespace-nowrap"
              >
                {month.label}
              </span>
            ))}
          </div>
          <div role="grid" aria-label="近一年每日活动" className="space-y-[3px]">
            {grid.weekdayLabels.map((label, dayIndex) => (
              <div
                key={label}
                role="row"
                className="grid items-center gap-[3px]"
                style={{ gridTemplateColumns }}
              >
                <span
                  role="rowheader"
                  className="text-[10px] text-neutral-500 dark:text-neutral-400"
                >
                  {dayIndex % 2 === 0 ? label : <span className="sr-only">{label}</span>}
                </span>
                {grid.weeks.map((week, weekIndex) => {
                  const day = week[dayIndex]
                  return (
                    <div
                      key={weekIndex}
                      role="gridcell"
                      aria-selected={day ? day.date === selected?.date : undefined}
                    >
                      {day ? (
                        <button
                          type="button"
                          data-date={day.date}
                          title={cellTitle(day)}
                          aria-label={cellTitle(day)}
                          tabIndex={day.date === selected?.date ? 0 : -1}
                          className={clsx(
                            'hc-heat-cell block aspect-square w-full',
                            LEVEL_CLASS[day.level],
                            day.date === selected?.date &&
                              'ring-2 ring-sky-600 ring-offset-1 ring-offset-neutral-50 dark:ring-sky-300 dark:ring-offset-neutral-900',
                          )}
                          onFocus={() => setSelectedDate(day.date)}
                          onClick={() => {
                            setSelectedDate(day.date)
                            setHoveredDate(null)
                          }}
                          onPointerEnter={(event) => {
                            if (event.pointerType === 'mouse') setHoveredDate(day.date)
                          }}
                          onKeyDown={(event) => {
                            const index = cells.findIndex((cell) => cell.date === day.date)
                            const destination = {
                              ArrowLeft: index - 7,
                              ArrowRight: index + 7,
                              ArrowUp: index - 1,
                              ArrowDown: index + 1,
                              Home: 0,
                              End: cells.length - 1,
                            }[event.key]
                            if (destination !== undefined) {
                              event.preventDefault()
                              selectDay(destination, true)
                            }
                          }}
                        />
                      ) : (
                        <span className="block aspect-square" />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
        <span>
          选择日期查看明细<span className="sm:hidden"> · 左右滑动</span>
        </span>
        <div className="flex items-center gap-1.5" aria-label="颜色由浅到深表示用量由少到多">
          <span>少</span>
          {LEVEL_CLASS.map((level) => (
            <span key={level} className={clsx('hc-heat-cell h-2.5 w-2.5', level)} />
          ))}
          <span>多</span>
        </div>
      </div>
      {inspected && (
        <div className="mt-4 grid items-center gap-x-8 gap-y-4 rounded-lg bg-white px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)] dark:bg-neutral-950/50">
          <div className="flex items-center gap-1">
            <Button
              aria-label="前一天"
              variant="ghost"
              size="sm"
              className="px-1.5"
              disabled={selectedIndex === 0}
              onClick={() => selectDay(selectedIndex - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="date"
              aria-label="查看某天用量"
              className={clsx(inputClass, 'w-36')}
              min={cells[0]?.date}
              max={cells.at(-1)?.date}
              value={inspected.date}
              onChange={(event) => {
                const index = cells.findIndex((day) => day.date === event.target.value)
                if (index >= 0) selectDay(index)
              }}
            />
            <Button
              aria-label="后一天"
              variant="ghost"
              size="sm"
              className="px-1.5"
              disabled={selectedIndex === cells.length - 1}
              onClick={() => selectDay(selectedIndex + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <dl aria-live="polite" className="grid min-w-0 grid-cols-3 gap-4 text-xs tabular-nums">
            {[
              ['请求', formatInt(inspected.requests)],
              ['Token', formatInt(inspected.totalTokens)],
              ['花费 · USD', formatUsageMetric(inspected.costUsd, 'costUsd', true)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="mb-1 text-neutral-500 dark:text-neutral-400">{label}</dt>
                <dd className="break-all font-medium text-neutral-800 dark:text-neutral-100">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </UsageSection>
  )
}
