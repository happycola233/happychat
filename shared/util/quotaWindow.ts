import type { QuotaWeekStart, QuotaWindow } from '../types/domain'

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

/** 滚动窗口的可选长度上限（1 年）；再长就该用「永久累计」。 */
export const QUOTA_ROLLING_MAX_HOURS = 8760

export interface QuotaPeriodOptions {
  /** 日历周期的边界时区（IANA）；非法值回退 UTC，绝不抛错。 */
  timezone: string
  weekStart: QuotaWeekStart
}

export interface QuotaPeriod {
  /** 窗口起点（含）。`total` 窗口为 0。 */
  startMs: number
  /** 窗口终点（不含），即下次重置时刻；不会重置的窗口为 null。 */
  endMs: number | null
}

/** 取某时刻在指定时区的 UTC 偏移（分钟，东为正）。时区非法时按 UTC 处理。 */
function timezoneOffsetMinutes(timeMs: number, timezone: string): number {
  const parts = localDateParts(timeMs, timezone)
  if (!parts) return 0
  // Date.UTC(本地墙上时间) - 真实时刻 = 该时刻的 UTC 偏移
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0)
  return Math.round((asUtc - Math.floor(timeMs / 60_000) * 60_000) / 60_000)
}

interface LocalDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** 用 Intl 解析某时刻在指定时区的墙上时间；时区非法返回 null（调用方按 UTC 处理）。 */
function localDateParts(timeMs: number, timezone: string): LocalDateParts | null {
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return null
  }
  const values: Record<string, number> = {}
  for (const part of formatter.formatToParts(new Date(timeMs))) {
    if (part.type === 'literal') continue
    values[part.type] = Number(part.value)
  }
  const { year, month, day } = values
  if (year === undefined || month === undefined || day === undefined) return null
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  // Intl 在午夜可能给出 24 时制的 "24"，归一为 0 以免推到次日。
  const hour = (values.hour ?? 0) % 24
  return { year, month, day, hour, minute: values.minute ?? 0 }
}

/**
 * 求「某时区某个墙上日期 00:00」对应的 UTC 毫秒。
 *
 * 先按目标日期附近的偏移试算，再用试算结果所在时刻的真实偏移校正一次——
 * DST 切换日的偏移在当天内会变化，只算一次会偏移 1 小时。
 */
function localMidnightMs(year: number, month: number, day: number, timezone: string): number {
  const wallClockMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  let guess = wallClockMs - timezoneOffsetMinutes(wallClockMs, timezone) * 60_000
  const corrected = wallClockMs - timezoneOffsetMinutes(guess, timezone) * 60_000
  if (corrected !== guess) guess = corrected
  return guess
}

/** 该时刻在指定时区所处「本地日」的 0 点。 */
function startOfLocalDay(timeMs: number, timezone: string): number {
  const parts = localDateParts(timeMs, timezone)
  if (!parts) return Math.floor(timeMs / DAY_MS) * DAY_MS
  return localMidnightMs(parts.year, parts.month, parts.day, timezone)
}

/** 加 n 天后再取本地 0 点：跨 DST 时天长不是恒定 24h，必须按墙上日期推进。 */
function addLocalDays(startOfDayMs: number, days: number, timezone: string): number {
  const parts = localDateParts(startOfDayMs, timezone)
  if (!parts) return startOfDayMs + days * DAY_MS
  return localMidnightMs(parts.year, parts.month, parts.day + days, timezone)
}

/** 本地星期（0=周日……6=周六）。 */
function localWeekday(timeMs: number, timezone: string): number {
  const parts = localDateParts(timeMs, timezone)
  if (!parts) return new Date(timeMs).getUTCDay()
  // 用 UTC 构造同一墙上日期即可取到正确星期，与时区偏移无关。
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

/**
 * 解析限额窗口在 `nowMs` 时刻的区间。纯函数，服务端判定与前端展示共用。
 *
 * 日历周期按配置时区计算边界，因此「每天 300 次」在中国用户看来就是本地 0 点重置；
 * 滚动窗口不对齐任何边界（`now - hours`），与 Codex / Claude Code 的体感一致。
 */
export function resolveQuotaPeriod(
  window: QuotaWindow,
  nowMs: number,
  options: QuotaPeriodOptions,
): QuotaPeriod {
  if (window.type === 'total') return { startMs: 0, endMs: null }
  if (window.type === 'rolling') {
    const hours = Math.min(
      QUOTA_ROLLING_MAX_HOURS,
      Math.max(1, Number.isFinite(window.hours) ? window.hours : 1),
    )
    return { startMs: nowMs - hours * HOUR_MS, endMs: null }
  }

  const timezone = options.timezone
  const dayStart = startOfLocalDay(nowMs, timezone)
  if (window.period === 'day') {
    return { startMs: dayStart, endMs: addLocalDays(dayStart, 1, timezone) }
  }
  if (window.period === 'week') {
    const weekday = localWeekday(dayStart, timezone)
    const back = options.weekStart === 'sun' ? weekday : (weekday + 6) % 7
    const weekStart = addLocalDays(dayStart, -back, timezone)
    return { startMs: weekStart, endMs: addLocalDays(weekStart, 7, timezone) }
  }

  const parts = localDateParts(nowMs, timezone)
  if (!parts) {
    // 时区不可用时退化为 UTC 月，仍保证 start < end 且边界稳定。
    const utc = new Date(nowMs)
    const start = Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), 1)
    const end = Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth() + 1, 1)
    return { startMs: start, endMs: end }
  }
  const monthStart = localMidnightMs(parts.year, parts.month, 1, timezone)
  // Date.UTC 会自然处理 12 月 → 次年 1 月的进位。
  const nextMonth = new Date(Date.UTC(parts.year, parts.month, 1))
  const monthEnd = localMidnightMs(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    1,
    timezone,
  )
  return { startMs: monthStart, endMs: monthEnd }
}

/** 滚动窗口长度的中文短描述（5 小时 / 7 天 / 30 天 / 90 小时）。 */
export function describeRollingHours(hours: number): string {
  if (hours % 24 === 0 && hours >= 24) return `${hours / 24} 天`
  return `${hours} 小时`
}

/** 窗口的中文短描述，用于规则摘要与进度条标题。 */
export function describeQuotaWindow(window: QuotaWindow): string {
  if (window.type === 'total') return '永久累计'
  if (window.type === 'rolling') return `滚动 ${describeRollingHours(window.hours)}`
  return window.period === 'day' ? '每天' : window.period === 'week' ? '每周' : '每月'
}
