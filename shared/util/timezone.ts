const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

export interface ZonedDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * 校验并规范化 IANA 时区名。无效值返回 null，由调用方决定使用 UTC 还是兼容旧偏移。
 */
export function canonicalizeIanaTimezone(timezone: string | null | undefined): string | null {
  if (!timezone) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

function dateTimeFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = dateTimeFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    dateTimeFormatters.set(timezone, formatter)
  }
  return formatter
}

/** 读取某个真实时刻在目标 IANA 时区的墙上日期与时间。 */
export function zonedDateParts(timeMs: number, timezone: string): ZonedDateParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {}
  for (const part of dateTimeFormatter(timezone).formatToParts(new Date(timeMs))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    // 少数运行时会把午夜格式化为 24:00；在日期部分不变时应归一成 00:00。
    hour: (values.hour ?? 0) % 24,
    minute: values.minute ?? 0,
  }
}

/** 取某时刻在目标 IANA 时区的 UTC 偏移（分钟，东为正）。 */
export function zonedOffsetMinutes(timeMs: number, timezone: string): number {
  const parts = zonedDateParts(timeMs, timezone)
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const realMinute = Math.floor(timeMs / MINUTE_MS) * MINUTE_MS
  return Math.round((wallClockAsUtc - realMinute) / MINUTE_MS)
}

/**
 * 求目标时区某个墙上日期 00:00 对应的真实时刻。
 *
 * 先按日期附近的偏移试算，再用试算时刻的实际偏移校正。这样 DST 切换日即使
 * 日内偏移发生变化，日历边界仍落在当地午夜，而不是固定的 24 小时间隔。
 */
export function zonedMidnightMs(
  year: number,
  month: number,
  day: number,
  timezone: string,
): number {
  // 调用方会用 day+N / month+N 推进日历，先沿用 Date 的进位规则规范化目标日期。
  const normalizedDate = new Date(Date.UTC(year, month - 1, day))
  const targetYear = normalizedDate.getUTCFullYear()
  const targetMonth = normalizedDate.getUTCMonth() + 1
  const targetDay = normalizedDate.getUTCDate()
  const wallClockMs = normalizedDate.getTime()
  let guess = wallClockMs - zonedOffsetMinutes(wallClockMs, timezone) * MINUTE_MS
  const corrected = wallClockMs - zonedOffsetMinutes(guess, timezone) * MINUTE_MS
  if (corrected !== guess) guess = corrected

  const targetDate = targetYear * 10_000 + targetMonth * 100 + targetDay
  const dateValueAt = (timeMs: number) => {
    const parts = zonedDateParts(timeMs, timezone)
    return parts.year * 10_000 + parts.month * 100 + parts.day
  }
  const parts = zonedDateParts(guess, timezone)
  if (
    parts.year === targetYear &&
    parts.month === targetMonth &&
    parts.day === targetDay &&
    parts.hour === 0 &&
    parts.minute === 0 &&
    dateValueAt(guess - 1) < targetDate
  ) {
    return guess
  }

  // 有些地区会在 00:00 切入夏令时，当天第一个真实墙上时刻是 01:00；固定点校正
  // 会在跳变两侧振荡。只在快路径未命中时，查找本地日期首次进入目标日的真实时刻。
  let previous = wallClockMs - 48 * HOUR_MS
  let previousDate = dateValueAt(previous)
  const searchEnd = wallClockMs + 48 * HOUR_MS
  for (let probe = previous + HOUR_MS; probe <= searchEnd; probe += HOUR_MS) {
    const probeDate = dateValueAt(probe)
    if (previousDate < targetDate && probeDate >= targetDate) {
      let low = previous
      let high = probe
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2)
        if (dateValueAt(middle) >= targetDate) high = middle
        else low = middle
      }
      return high
    }
    previous = probe
    previousDate = probeDate
  }
  return guess
}

/** 该时刻在目标时区所处本地日的 0 点。 */
export function startOfZonedDay(timeMs: number, timezone: string): number {
  const parts = zonedDateParts(timeMs, timezone)
  return zonedMidnightMs(parts.year, parts.month, parts.day, timezone)
}

/** 按墙上日期前进若干天；跨 DST 时不会假设一天恒为 24 小时。 */
export function addZonedDays(startOfDayMs: number, days: number, timezone: string): number {
  const parts = zonedDateParts(startOfDayMs, timezone)
  return zonedMidnightMs(parts.year, parts.month, parts.day + days, timezone)
}

/** 目标时区的本地星期（0=周日……6=周六）。 */
export function zonedWeekday(timeMs: number, timezone: string): number {
  const parts = zonedDateParts(timeMs, timezone)
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}
