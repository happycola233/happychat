import type { QuotaBucketUsageDTO } from '@shared/types/api'
import { describeQuotaHours, describeQuotaWindow } from '@shared/util/quotaWindow'

const timestampFormatters = new Map<string, Intl.DateTimeFormat>()

/** 常用周期边界时区；设置页与所有管理端额度快照共用同一套人类可读名称。 */
export const QUOTA_TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: '中国标准时间（UTC+8）' },
  { value: 'Asia/Tokyo', label: '日本标准时间（UTC+9）' },
  { value: 'Asia/Singapore', label: '新加坡时间（UTC+8）' },
  { value: 'Europe/London', label: '英国时间（UTC+0/+1）' },
  { value: 'Europe/Berlin', label: '中欧时间（UTC+1/+2）' },
  { value: 'America/New_York', label: '美东时间（UTC-5/-4）' },
  { value: 'America/Los_Angeles', label: '美西时间（UTC-8/-7）' },
  { value: 'UTC', label: 'UTC' },
]

export function quotaTimezoneLabel(timezone: string): string {
  return QUOTA_TIMEZONE_OPTIONS.find((option) => option.value === timezone)?.label ?? timezone
}

function timestampFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = timestampFormatters.get(timezone)
  if (cached) return cached
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  timestampFormatters.set(timezone, formatter)
  return formatter
}

/** 管理端周期时间使用固定、无歧义的 `YYYY/MM/DD HH:mm`，并始终按额度边界时区格式化。 */
export function formatQuotaTimestamp(timestamp: number, timezone: string): string {
  if (!Number.isFinite(timestamp)) return '—'
  const values: Record<string, string> = {}
  for (const part of timestampFormatter(timezone).formatToParts(new Date(timestamp))) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  const year = values.year
  const month = values.month
  const day = values.day
  const rawHour = Number(values.hour)
  const hour = Number.isFinite(rawHour) ? String(rawHour % 24).padStart(2, '0') : values.hour
  const minute = values.minute
  if (!year || !month || !day || !hour || !minute) return '—'
  return `${year}/${month}/${day} ${hour}:${minute}`
}

export interface QuotaPeriodCopy {
  headline: string
  detail: string
}

/**
 * 周期展示严格区分四种语义：固定边界才显示起止时间；滚动窗口没有“重置时刻”，不能伪装成固定周期。
 */
export function quotaPeriodCopy(rule: QuotaBucketUsageDTO, timezone: string): QuotaPeriodCopy {
  if (rule.limit.kind === 'unlimited') {
    return {
      headline: describeQuotaWindow(rule.window),
      detail: '豁免规则不计量，也不会触发周期重置',
    }
  }
  if (rule.window.type === 'total') {
    return { headline: '永久累计', detail: '不会自动重置' }
  }
  if (rule.window.type === 'rolling') {
    const duration = describeQuotaHours(rule.window.hours)
    return {
      headline: `滚动窗口 · ${duration}`,
      detail: `始终统计当前时刻往前 ${duration}，无固定重置点`,
    }
  }
  if (rule.window.type === 'anchored' && !rule.periodActive) {
    return {
      headline: '固定周期 · 尚未开始',
      detail: `首次请求起 ${describeQuotaHours(rule.window.hours)}，空闲时不计时`,
    }
  }

  const start = formatQuotaTimestamp(rule.periodStart, timezone)
  const end = rule.periodEnd === null ? '—' : formatQuotaTimestamp(rule.periodEnd, timezone)
  if (rule.window.type === 'anchored') {
    return {
      headline: `固定周期 · ${describeQuotaHours(rule.window.hours)}`,
      detail: `${start} → ${end}（到点清零）`,
    }
  }
  const periodLabel =
    rule.window.period === 'day'
      ? '自然日周期'
      : rule.window.period === 'week'
        ? '自然周周期'
        : '自然月周期'
  return { headline: periodLabel, detail: `${start} → ${end}（到点重置）` }
}
