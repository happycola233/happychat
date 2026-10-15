import type { MessageTimeFormat } from '@shared/types/domain'

const formatters = new Map<string, Intl.DateTimeFormat>()

function dateTimeFormatter(options: Intl.DateTimeFormatOptions, timeZone: string) {
  const key = JSON.stringify([timeZone, options])
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('zh-CN', { ...options, timeZone })
    formatters.set(key, formatter)
  }
  return formatter
}

function formatDate(timestamp: number, options: Intl.DateTimeFormatOptions, timeZone: string) {
  return dateTimeFormatter(options, timeZone).format(timestamp)
}

export function isSameLocalDay(first: number, second: number): boolean {
  const a = new Date(first)
  const b = new Date(second)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function relativeDay(timestamp: number, today: number): string | null {
  if (isSameLocalDay(timestamp, today)) return '今天'
  const yesterday = new Date(today)
  // 按本地自然日回退，不能减去固定 24 小时（夏令时切换日并不总有 24 小时）。
  yesterday.setDate(yesterday.getDate() - 1)
  return isSameLocalDay(timestamp, yesterday.getTime()) ? '昨天' : null
}

export function formatMessageTime(
  timestamp: number,
  format: MessageTimeFormat,
  today: number,
  timeZone: string,
): string {
  const timeOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const
  if (format === 'datetime') {
    return formatDate(
      timestamp,
      { year: 'numeric', month: '2-digit', day: '2-digit', ...timeOptions },
      timeZone,
    )
  }
  const time = formatDate(timestamp, timeOptions, timeZone)
  if (format === 'time') return time
  const sameYear = new Date(timestamp).getFullYear() === new Date(today).getFullYear()
  const day = relativeDay(timestamp, today)
  if (day === '今天') return time
  if (sameYear && day === '昨天') return `昨天 ${time}`
  const date = formatDate(
    timestamp,
    { ...(sameYear ? {} : { year: 'numeric' }), month: 'long', day: 'numeric' },
    timeZone,
  )
  return `${date} ${time}`
}

export function formatMessageTimeDetails(timestamp: number, timeZone: string) {
  const parts = dateTimeFormatter(
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    },
    timeZone,
  ).formatToParts(timestamp)
  const time = parts
    .filter((part) => part.type !== 'timeZoneName')
    .map((part) => part.value)
    .join('')
    .trim()
  const offset = parts.find((part) => part.type === 'timeZoneName')!.value.replace('GMT', 'UTC')
  return {
    date: formatDate(
      timestamp,
      { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
      timeZone,
    ),
    time: `${time} · ${offset}`,
  }
}

export function formatMessageDay(timestamp: number, today: number, timeZone: string): string {
  const date = formatDate(timestamp, { year: 'numeric', month: 'long', day: 'numeric' }, timeZone)
  const day = relativeDay(timestamp, today)
  return day ? `${date} · ${day}` : date
}
