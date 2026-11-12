import { parseLocalDateTimeInput, toLocalDateTimeInput } from './localDateTime'

/**
 * 管理后台统计时间范围：
 * - 滚动范围（最近 24 小时 / 7 天 / 30 天）：每次请求时从当前时刻回推；
 * - 自然日（今天 / 昨天）：按浏览器本地时区的 0 点切分；
 * - 自定义：精确到分钟的起止时刻。
 * 有固定终点的范围统一按半开区间 [start, end) 理解，相邻两段首尾相接、互不重叠。
 */
const ROLLING_RANGE_HOURS = { '24h': 24, '7d': 168, '30d': 720 } as const

export type RollingRangeKey = keyof typeof ROLLING_RANGE_HOURS

export const RANGE_PRESETS = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: '24h', label: '最近 24 小时' },
  { key: '7d', label: '最近 7 天' },
  { key: '30d', label: '最近 30 天' },
  { key: 'all', label: '全部时间' },
] as const satisfies readonly { key: string; label: string }[]

export type RangePresetKey = (typeof RANGE_PRESETS)[number]['key']

export type DateRange = { key: RangePresetKey } | { key: 'custom'; start: number; end: number }

export const DEFAULT_DATE_RANGE: DateRange = { key: '7d' }

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

/** 本地日历日的 0 点；用日期进位而不是加 24 小时，夏令时切换日也能落在 0 点。 */
export function startOfLocalDay(ts: number, offsetDays = 0): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays).getTime()
}

function isRolling(key: DateRange['key']): key is RollingRangeKey {
  return Object.hasOwn(ROLLING_RANGE_HOURS, key)
}

/** 解析为具体时刻。start 缺省表示不设下界；end 为开区间终点，滚动范围与「全部时间」取 now。 */
export function resolveDateRange(
  range: DateRange,
  now = Date.now(),
): { start?: number; end: number } {
  if (range.key === 'custom') return { start: range.start, end: range.end }
  if (range.key === 'today') return { start: startOfLocalDay(now), end: startOfLocalDay(now, 1) }
  if (range.key === 'yesterday')
    return { start: startOfLocalDay(now, -1), end: startOfLocalDay(now) }
  if (range.key === 'all') return { end: now }
  return { start: now - ROLLING_RANGE_HOURS[range.key] * HOUR_MS, end: now }
}

/**
 * 转成统计接口的闭区间 { from?, to? }。
 * 滚动范围与「全部时间」不发送 to：截止时刻交给服务端时钟，避免浏览器时钟偏慢时漏掉最新请求。
 */
export function rangeToFilter(range: DateRange, now = Date.now()): { from?: number; to?: number } {
  const { start, end } = resolveDateRange(range, now)
  const openEnded = range.key === 'all' || isRolling(range.key)
  return { from: start, to: openEnded ? undefined : end - 1 }
}

/** URL 查询参数：自定义范围用本地分钟字符串，便于阅读与转发。 */
const RANGE_PARAM_KEYS = ['range', 'from', 'to'] as const

export function readDateRange(params: URLSearchParams): DateRange {
  const key = params.get('range')
  if (key === 'custom') {
    const start = parseLocalDateTimeInput(params.get('from') ?? '')
    const end = parseLocalDateTimeInput(params.get('to') ?? '')
    if (start != null && end != null && start < end) return { key, start, end }
  }
  const preset = RANGE_PRESETS.find((item) => item.key === key)
  return preset ? { key: preset.key } : DEFAULT_DATE_RANGE
}

export function dateRangeParams(range: DateRange): Record<string, string> {
  return range.key === 'custom'
    ? {
        range: 'custom',
        from: toLocalDateTimeInput(range.start),
        to: toLocalDateTimeInput(range.end),
      }
    : { range: range.key }
}

/** 返回替换了时间范围参数的新查询串，保留其它筛选。 */
export function withDateRange(params: URLSearchParams, range: DateRange): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of RANGE_PARAM_KEYS) next.delete(key)
  for (const [key, value] of Object.entries(dateRangeParams(range))) next.set(key, value)
  return next
}

/** 文件名 / React key 用的稳定短标识。 */
export function dateRangeSlug(range: DateRange): string {
  if (range.key !== 'custom') return range.key
  const compact = (ts: number) => toLocalDateTimeInput(ts).replace(':', '')
  return `${compact(range.start)}_${compact(range.end)}`
}

/**
 * 界面展示文案。自定义范围起止都在 0 点时按整天显示（结束日为包含的最后一天），
 * 否则显示到分钟；与今年不同的年份才显示年份，同一天只写一次日期。
 */
export function formatDateRange(range: DateRange, now = Date.now()): string {
  if (range.key !== 'custom') return RANGE_PRESETS.find((item) => item.key === range.key)!.label
  const thisYear = new Date(now).getFullYear()
  const date = (ts: number) => {
    const d = new Date(ts)
    const year = d.getFullYear() === thisYear ? '' : `${d.getFullYear()}年`
    return `${year}${d.getMonth() + 1}月${d.getDate()}日`
  }
  const time = (ts: number) => toLocalDateTimeInput(ts).slice(11)
  const { start, end } = range
  if (start === startOfLocalDay(start) && end === startOfLocalDay(end)) {
    const lastDay = startOfLocalDay(end, -1)
    return lastDay === start ? date(start) : `${date(start)} – ${date(lastDay)}`
  }
  const sameDay = startOfLocalDay(start) === startOfLocalDay(end)
  return `${date(start)} ${time(start)} – ${sameDay ? '' : `${date(end)} `}${time(end)}`
}

/** 自定义输入框的初始值：沿用当前范围，并对齐到整分钟；「全部时间」从今天 0 点开始。 */
export function draftDateRange(range: DateRange, now = Date.now()): { start: number; end: number } {
  const { start, end } = resolveDateRange(range, now)
  return {
    start: Math.floor((start ?? startOfLocalDay(now)) / MINUTE_MS) * MINUTE_MS,
    end: Math.ceil(end / MINUTE_MS) * MINUTE_MS,
  }
}
