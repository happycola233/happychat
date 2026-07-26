/** 导出专用的时区感知时间格式化（基于 Intl，无第三方依赖）。 */

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>()
const weekdayFormatterCache = new Map<string, Intl.DateTimeFormat>()

/**
 * 校验 IANA 时区并归一化（大小写变体坍缩为规范名）；无效或缺省时回退服务器本地时区。
 * 归一化保证下方格式化器缓存的键空间是有限的规范时区集合，用户可控串刷不大缓存。
 */
export function resolveTimezone(timezone: string | undefined | null): string {
  if (timezone) {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone
    } catch {
      // 非法时区字符串，走回退
    }
  }
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

function datetimeParts(ms: number, timezone: string): Record<string, string> {
  let formatter = partsFormatterCache.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    partsFormatterCache.set(timezone, formatter)
  }
  const out: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(ms))) out[part.type] = part.value
  return out
}

/** YYYY-MM-DD（目标时区的本地日期）。 */
export function formatLocalDate(ms: number, timezone: string): string {
  const p = datetimeParts(ms, timezone)
  return `${p.year}-${p.month}-${p.day}`
}

/** 按精度格式化时间戳：day=YYYY-MM-DD / minute=… HH:mm / second=… HH:mm:ss。 */
export function formatStamp(
  ms: number,
  timezone: string,
  precision: 'second' | 'minute' | 'day',
): string {
  const p = datetimeParts(ms, timezone)
  const date = `${p.year}-${p.month}-${p.day}`
  if (precision === 'day') return date
  if (precision === 'minute') return `${date} ${p.hour}:${p.minute}`
  return `${date} ${p.hour}:${p.minute}:${p.second}`
}

const WEEKDAY_ZH: Record<string, string> = {
  Sun: '周日',
  Mon: '周一',
  Tue: '周二',
  Wed: '周三',
  Thu: '周四',
  Fri: '周五',
  Sat: '周六',
}

/** 目标时区的中文星期（周一…周日）。 */
export function formatWeekdayZh(ms: number, timezone: string): string {
  let formatter = weekdayFormatterCache.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
    weekdayFormatterCache.set(timezone, formatter)
  }
  return WEEKDAY_ZH[formatter.format(new Date(ms))] ?? ''
}

/** 思考/生成时长的短格式：40s / 1m 24s（与 chatlog-md 规范示例一致）。 */
export function formatDurationShort(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

/** 用量统计里的耗时：秒为单位保留 1 位小数（3.2s），超过 1 分钟转短格式。 */
export function formatDurationSeconds(ms: number): string {
  if (ms >= 60_000) return formatDurationShort(ms)
  return `${(ms / 1000).toFixed(1)}s`
}
