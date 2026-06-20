import { titleLocaleFromBrowser } from '@shared/util/titleLocale'

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export interface PromptVarContext {
  user: { username: string; displayName: string | null } | null
  model: { displayName: string; modelId: string }
  now: Date
  clientLocale?: string
}

/** 计算系统提示词变量的实际值（服务器本地时间；iso_datetime 用 UTC）。 */
export function buildPromptVars(ctx: PromptVarContext): Record<string, string> {
  const d = ctx.now
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  let timezone = 'UTC'
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    // 某些运行时缺少 Intl 时区信息，回退 UTC
  }
  return {
    current_date: date,
    current_time: time,
    current_datetime: `${date} ${time}:${pad(d.getSeconds())}`,
    iso_datetime: d.toISOString(),
    current_year: String(d.getFullYear()),
    current_weekday: WEEKDAYS[d.getDay()]!,
    current_user: ctx.user?.displayName || ctx.user?.username || '',
    current_username: ctx.user?.username ?? '',
    locale: titleLocaleFromBrowser(ctx.clientLocale),
    model_name: ctx.model.displayName,
    model_id: ctx.model.modelId,
    timezone,
  }
}
