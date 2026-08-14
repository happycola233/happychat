import { clsx } from 'clsx'
import { formatInt } from '../lib/format'

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 单序列细柱：数据端 3px 圆角、柱间 2px 表面缝隙，坐标轴与刻度保持弱化。 */
function BarRow({
  values,
  labelOf,
  tooltipOf,
  compact,
}: {
  values: number[]
  labelOf: (index: number) => string
  tooltipOf: (index: number, value: number) => string
  /** 24 格时刻度只标偶数点，避免文字互相挤压 */
  compact?: boolean
}) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex items-end gap-[2px]">
      {values.map((value, index) => (
        <div key={index} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex h-20 w-full items-end" title={tooltipOf(index, value)}>
            <div
              className="hc-activity-bar w-full transition-[height] duration-300"
              data-empty={value === 0 ? 'true' : undefined}
              style={{ height: `${value === 0 ? 2 : Math.max(6, (value / max) * 80)}px` }}
              role="img"
              aria-label={tooltipOf(index, value)}
            />
          </div>
          <span
            className={clsx(
              'text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500',
              compact && index % 2 === 1 && 'invisible',
            )}
          >
            {labelOf(index)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * 活跃节律：按本地小时与星期的请求分布。
 * 两张图都是单序列（只有「请求数」一个测度），因此不需要图例，标题即序列名。
 */
export function ActivityRhythm({
  byHour,
  byWeekday,
  busiestHour,
  busiestWeekday,
}: {
  byHour: number[]
  byWeekday: number[]
  busiestHour: number | null
  busiestWeekday: number | null
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            一天中的分布
          </h2>
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {busiestHour === null ? '暂无数据' : `最活跃 ${busiestHour}:00`}
          </span>
        </div>
        <BarRow
          values={byHour}
          compact
          labelOf={(index) => String(index)}
          tooltipOf={(index, value) => `${index}:00–${index}:59 · ${formatInt(value)} 次请求`}
        />
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            一周中的分布
          </h2>
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {busiestWeekday === null ? '暂无数据' : `最活跃 ${WEEKDAY_LABELS[busiestWeekday]}`}
          </span>
        </div>
        <BarRow
          values={byWeekday}
          labelOf={(index) => WEEKDAY_LABELS[index]!.slice(1)}
          tooltipOf={(index, value) => `${WEEKDAY_LABELS[index]} · ${formatInt(value)} 次请求`}
        />
      </div>
    </div>
  )
}
