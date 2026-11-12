/**
 * epoch ms ↔ `<input type="datetime-local">` 使用的本地时间字符串（YYYY-MM-DDTHH:mm）。
 * 不带时区后缀的日期时间字符串按规范解析为浏览器本地时间。
 */
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/

export function toLocalDateTimeInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 格式不符或日期无效时返回 null。 */
export function parseLocalDateTimeInput(value: string): number | null {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}
