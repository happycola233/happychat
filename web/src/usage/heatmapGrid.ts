import type { UsageHeatmapCellDTO } from '@shared/types/api'

/** 热力图可切换的三种计量口径。 */
export type HeatmapMetric = 'requests' | 'tokens' | 'cost'

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4

export interface HeatmapDay {
  /** YYYY-MM-DD（用户本地日，由服务端按时区偏移分格） */
  date: string
  requests: number
  totalTokens: number
  costUsd: number
  /** 当前口径下的值 */
  value: number
  /** 0=无活动，1–4 按非零值分位数分级（与 GitHub 贡献图同思路） */
  level: HeatmapLevel
}

/** 一列＝一周；未落在数据范围内的格子为 null（首尾补空，保持工作日行对齐）。 */
export type HeatmapWeek = (HeatmapDay | null)[]

export interface HeatmapGrid {
  weeks: HeatmapWeek[]
  /** 行标签（按 weekStart 排列的星期简称） */
  weekdayLabels: string[]
  /** 月份刻度：列索引 → 中文月份，稀疏放置避免拥挤 */
  monthLabels: { weekIndex: number; label: string }[]
  max: number
  total: number
  /** 有活动的天数 */
  activeDays: number
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
/** 月份标签之间至少间隔的列数，避免相邻月份挤在一起。 */
const MONTH_LABEL_MIN_GAP = 3

function metricValue(cell: UsageHeatmapCellDTO, metric: HeatmapMetric): number {
  if (metric === 'tokens') return cell.totalTokens
  if (metric === 'cost') return cell.costUsd
  return cell.requests
}

/** 只用日期字符串推星期，避免受浏览器时区影响（服务端已按用户本地日分好格）。 */
function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay()
}

/**
 * 非零值的四分位阈值。分位数而不是「最大值等分」：
 * 偶尔一天暴用 200 次不该把其余所有天都压成最浅一档。
 */
function levelThresholds(values: number[]): [number, number, number] {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
  return [at(0.25), at(0.5), at(0.75)]
}

function levelOf(value: number, thresholds: [number, number, number]): HeatmapLevel {
  if (value <= 0) return 0
  if (value <= thresholds[0]) return 1
  if (value <= thresholds[1]) return 2
  if (value <= thresholds[2]) return 3
  return 4
}

/**
 * 把服务端返回的连续日序列铺成「按周分列」的热力图网格。
 *
 * 纯函数：列＝周、行＝星期，首列前与末列后用 null 补齐，
 * 因此同一行永远是同一个星期，鼠标横向移动即在比较「每周同一天」。
 */
export function buildHeatmapGrid(
  cells: UsageHeatmapCellDTO[],
  options: { metric?: HeatmapMetric; weekStart?: 'mon' | 'sun' } = {},
): HeatmapGrid {
  const metric = options.metric ?? 'requests'
  const weekStart = options.weekStart ?? 'mon'
  const offset = weekStart === 'mon' ? 1 : 0
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => WEEKDAY_NAMES[(index + offset) % 7]!)

  const days: HeatmapDay[] = cells.map((cell) => ({
    date: cell.date,
    requests: cell.requests,
    totalTokens: cell.totalTokens,
    costUsd: cell.costUsd,
    value: metricValue(cell, metric),
    level: 0,
  }))
  const positives = days.map((day) => day.value).filter((value) => value > 0)
  const thresholds = levelThresholds(positives)
  for (const day of days) day.level = levelOf(day.value, thresholds)

  const weeks: HeatmapWeek[] = []
  let current: HeatmapWeek = Array.from({ length: 7 }, () => null)
  let filled = false
  for (const day of days) {
    // 行索引：把「真实星期」按 weekStart 旋转到 0–6。
    const row = (weekdayOf(day.date) - offset + 7) % 7
    if (filled && row === 0) {
      weeks.push(current)
      current = Array.from({ length: 7 }, () => null)
    }
    current[row] = day
    filled = true
  }
  if (filled) weeks.push(current)

  const monthLabels: { weekIndex: number; label: string }[] = []
  let previousMonth: string | null = null
  weeks.forEach((week, weekIndex) => {
    const firstDay = week.find((day): day is HeatmapDay => day !== null)
    if (!firstDay) return
    const month = firstDay.date.slice(0, 7)
    if (month === previousMonth) return
    previousMonth = month
    const last = monthLabels[monthLabels.length - 1]
    if (last && weekIndex - last.weekIndex < MONTH_LABEL_MIN_GAP) return
    monthLabels.push({ weekIndex, label: `${Number(firstDay.date.slice(5, 7))} 月` })
  })

  return {
    weeks,
    weekdayLabels,
    monthLabels,
    max: days.reduce((max, day) => Math.max(max, day.value), 0),
    total: days.reduce((sum, day) => sum + day.value, 0),
    activeDays: days.filter((day) => day.requests > 0).length,
  }
}
