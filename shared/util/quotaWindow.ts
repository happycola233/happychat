import type { QuotaWeekStart, QuotaWindow } from '../types/domain'
import {
  addZonedDays,
  canonicalizeIanaTimezone,
  startOfZonedDay,
  zonedDateParts,
  zonedMidnightMs,
  zonedWeekday,
} from './timezone'

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

/** 按小时配置的窗口长度上限（1 年）；再长就该用「永久累计」。 */
export const QUOTA_HOURLY_WINDOW_MAX_HOURS = 8760

export interface QuotaPeriodOptions {
  /** 日历周期的边界时区（IANA）；非法值回退 UTC，绝不抛错。 */
  timezone: string
  weekStart: QuotaWeekStart
  /** anchored 窗口的已持久化起点；没有活动周期时省略。 */
  anchoredStartMs?: number | null
}

export interface QuotaPeriod {
  /** 窗口起点（含）。`total` 窗口为 0。 */
  startMs: number
  /** 窗口终点（不含），即下次重置时刻；不会重置的窗口为 null。 */
  endMs: number | null
  /** anchored 尚未被首次请求启动或上一周期已到期时为 false；其他窗口恒为 true。 */
  active: boolean
}

/**
 * 解析限额窗口在 `nowMs` 时刻的区间。纯函数，服务端判定与前端展示共用。
 *
 * 日历周期按配置时区计算边界，因此「每天 300 次」在中国用户看来就是本地 0 点重置；
 * 滚动窗口不对齐任何边界（`now - hours`）；首次请求起算窗口则必须传入持久化锚点。
 */
export function resolveQuotaPeriod(
  window: QuotaWindow,
  nowMs: number,
  options: QuotaPeriodOptions,
): QuotaPeriod {
  if (window.type === 'total') return { startMs: 0, endMs: null, active: true }
  if (window.type === 'rolling') {
    const hours = Math.min(
      QUOTA_HOURLY_WINDOW_MAX_HOURS,
      Math.max(1, Number.isFinite(window.hours) ? window.hours : 1),
    )
    return { startMs: nowMs - hours * HOUR_MS, endMs: null, active: true }
  }
  if (window.type === 'anchored') {
    const startMs = options.anchoredStartMs
    if (startMs === null || startMs === undefined || !Number.isFinite(startMs)) {
      return { startMs: 0, endMs: null, active: false }
    }
    const hours = Math.min(
      QUOTA_HOURLY_WINDOW_MAX_HOURS,
      Math.max(1, Number.isFinite(window.hours) ? window.hours : 1),
    )
    const endMs = startMs + hours * HOUR_MS
    return endMs > nowMs
      ? { startMs, endMs, active: true }
      : { startMs: 0, endMs: null, active: false }
  }

  // 配额设置的非法时区沿用既有契约回退 UTC；后续共享 helper 因而只处理有效 IANA 名。
  const timezone = canonicalizeIanaTimezone(options.timezone) ?? 'UTC'
  const dayStart = startOfZonedDay(nowMs, timezone)
  if (window.period === 'day') {
    return { startMs: dayStart, endMs: addZonedDays(dayStart, 1, timezone), active: true }
  }
  if (window.period === 'week') {
    const weekday = zonedWeekday(dayStart, timezone)
    const back = options.weekStart === 'sun' ? weekday : (weekday + 6) % 7
    const weekStart = addZonedDays(dayStart, -back, timezone)
    return { startMs: weekStart, endMs: addZonedDays(weekStart, 7, timezone), active: true }
  }

  const parts = zonedDateParts(nowMs, timezone)
  const monthStart = zonedMidnightMs(parts.year, parts.month, 1, timezone)
  // Date.UTC 会自然处理 12 月 → 次年 1 月的进位。
  const nextMonth = new Date(Date.UTC(parts.year, parts.month, 1))
  const monthEnd = zonedMidnightMs(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    1,
    timezone,
  )
  return { startMs: monthStart, endMs: monthEnd, active: true }
}

/** 小时型窗口长度的中文短描述（5 小时 / 7 天 / 30 天 / 90 小时）。 */
export function describeQuotaHours(hours: number): string {
  if (hours % 24 === 0 && hours >= 24) return `${hours / 24} 天`
  return `${hours} 小时`
}

/** 窗口的中文短描述，用于规则摘要与进度条标题。 */
export function describeQuotaWindow(window: QuotaWindow): string {
  if (window.type === 'total') return '永久累计'
  if (window.type === 'rolling') return `滚动 ${describeQuotaHours(window.hours)}`
  if (window.type === 'anchored') return `首次请求起 ${describeQuotaHours(window.hours)}`
  return window.period === 'day' ? '每天' : window.period === 'week' ? '每周' : '每月'
}
