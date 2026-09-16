import { useState } from 'react'
import { clsx } from 'clsx'
import { formatInt, formatPercent } from '../lib/format'
import { UsageSection } from './UsagePrimitives'

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 柱图始终有文字读数；触屏点选、键盘左右键与悬停使用同一份数据。 */
function ActivityBars({
  values,
  labelOf,
  detailOf,
  initialIndex,
  label,
  compact,
}: {
  values: number[]
  labelOf: (index: number) => string
  detailOf: (index: number) => string
  initialIndex: number
  label: string
  compact?: boolean
}) {
  const [selectedIndex, setSelectedIndex] = useState(initialIndex)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const inspected = hoveredIndex ?? selectedIndex
  const max = Math.max(1, ...values)
  const total = values.reduce((sum, value) => sum + value, 0)
  return (
    <div>
      <div
        role="group"
        aria-label={label}
        className="flex items-end gap-1"
        onPointerLeave={() => setHoveredIndex(null)}
      >
        {values.map((value, index) => (
          <div key={index} className="min-w-0 flex-1 text-center">
            <button
              type="button"
              aria-label={detailOf(index) + ' · ' + formatInt(value) + ' 次请求'}
              aria-pressed={selectedIndex === index}
              tabIndex={selectedIndex === index ? 0 : -1}
              className="flex h-24 w-full items-end rounded-sm focus-visible:outline-2 focus-visible:outline-sky-500"
              onClick={() => setSelectedIndex(index)}
              onFocus={() => setSelectedIndex(index)}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') setHoveredIndex(index)
              }}
              onKeyDown={(event) => {
                const next = {
                  ArrowLeft: Math.max(0, index - 1),
                  ArrowRight: Math.min(values.length - 1, index + 1),
                  Home: 0,
                  End: values.length - 1,
                }[event.key]
                if (next !== undefined) {
                  event.preventDefault()
                  const group = event.currentTarget.closest('[role="group"]')
                  group?.querySelectorAll('button')[next]?.focus()
                }
              }}
            >
              <span
                aria-hidden
                className={clsx(
                  'hc-activity-bar w-full transition-opacity',
                  inspected !== index && 'opacity-45',
                )}
                data-empty={value === 0 ? 'true' : undefined}
                style={{ height: (value === 0 ? 2 : Math.max(4, (value / max) * 88)) + 'px' }}
              />
            </button>
            <span
              className={clsx(
                'mt-2 block text-[10px] text-neutral-500 dark:text-neutral-400',
                compact && index % 3 !== 0 && 'invisible',
              )}
            >
              {labelOf(index)}
            </span>
          </div>
        ))}
      </div>
      <div
        className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400"
        aria-live="polite"
      >
        <span>{detailOf(inspected)}</span>
        <strong className="font-medium text-neutral-800 dark:text-neutral-200">
          {formatInt(values[inspected] ?? 0)} 次
        </strong>
        <span>占比 {formatPercent(total ? (values[inspected] ?? 0) / total : 0)}</span>
      </div>
    </div>
  )
}

export function ActivityRhythm({
  byHour,
  byWeekday,
  busiestHour,
  busiestWeekday,
  showWeekday = true,
}: {
  byHour: number[]
  byWeekday: number[]
  busiestHour: number | null
  busiestWeekday: number | null
  showWeekday?: boolean
}) {
  // 星期分布从周一开始展示，保留服务端 0=周日的统计口径。
  const weekdays = [1, 2, 3, 4, 5, 6, 0]
  return (
    <UsageSection title="活跃时段" description="看看你通常在什么时候使用">
      <div className={clsx('grid gap-7', showWeekday && 'lg:grid-cols-[1.5fr_1fr] lg:gap-10')}>
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <h3 className="font-medium text-neutral-700 dark:text-neutral-200">一天中的分布</h3>
            <span className="text-neutral-500 dark:text-neutral-400">
              {busiestHour === null ? '暂无活动' : '最常用时段 ' + busiestHour + ':00'}
            </span>
          </div>
          <ActivityBars
            values={byHour}
            label="每小时请求分布"
            compact
            initialIndex={busiestHour ?? 0}
            labelOf={(index) => String(index).padStart(2, '0')}
            detailOf={(index) => index + ':00–' + index + ':59'}
          />
        </div>
        {showWeekday && (
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
              <h3 className="font-medium text-neutral-700 dark:text-neutral-200">一周中的分布</h3>
              <span className="text-neutral-500 dark:text-neutral-400">
                {busiestWeekday === null
                  ? '暂无活动'
                  : '最常使用 ' + WEEKDAY_LABELS[busiestWeekday]}
              </span>
            </div>
            <ActivityBars
              values={weekdays.map((day) => byWeekday[day]!)}
              label="每周请求分布"
              initialIndex={Math.max(0, weekdays.indexOf(busiestWeekday ?? 1))}
              labelOf={(index) => WEEKDAY_LABELS[weekdays[index]!]!}
              detailOf={(index) => WEEKDAY_LABELS[weekdays[index]!]!}
            />
          </div>
        )}
      </div>
    </UsageSection>
  )
}
