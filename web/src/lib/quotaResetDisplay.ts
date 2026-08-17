import type { QuotaBucketUsageDTO } from '@shared/types/api'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export type QuotaResetKind = 'scheduled' | 'pending' | 'rolling' | 'never'

export interface QuotaResetDisplay {
  kind: QuotaResetKind
  /** 芯片 / 提示条主文案，近处用相对时间，远处才写日期 */
  label: string
  /** 绝对时刻，给 title 与需要精确时间的地方 */
  detail?: string
}

type ResetSource = Pick<QuotaBucketUsageDTO, 'limit' | 'window' | 'periodActive' | 'periodEnd'>

/** 比较两条规则的重置展示是否相同，用来决定独立额度是否共用一枚芯片。 */
export function quotaResetKey(rule: ResetSource, now = Date.now()): string {
  const reset = describeQuotaReset(rule, now)
  if (!reset) return ''
  return `${reset.kind}:${reset.label}:${reset.detail ?? ''}`
}

/**
 * 用户端重置文案。豁免没有周期；固定边界用相对时间，避免「8/22 19:04 重置」
 * 和窗口说明挤在同一行灰色小字里。
 */
export function describeQuotaReset(rule: ResetSource, now = Date.now()): QuotaResetDisplay | null {
  if (rule.limit.kind === 'unlimited') return null
  if (rule.window.type === 'total') return { kind: 'never', label: '不会重置' }
  if (rule.window.type === 'anchored' && !rule.periodActive) {
    return { kind: 'pending', label: '首次请求后开始' }
  }
  if (rule.periodEnd === null) return { kind: 'rolling', label: '随时间释放' }
  return { kind: 'scheduled', ...formatScheduledReset(rule.periodEnd, now) }
}

function formatScheduledReset(at: number, now: number): { label: string; detail: string } {
  const detail = formatResetAbsolute(at)
  const remain = at - now
  if (remain <= 0) return { label: '即将重置', detail }
  if (remain < HOUR_MS) {
    return { label: `${Math.max(1, Math.round(remain / MINUTE_MS))} 分钟后重置`, detail }
  }
  if (remain < 2 * DAY_MS) {
    return { label: `${Math.max(1, Math.round(remain / HOUR_MS))} 小时后重置`, detail }
  }
  if (remain < 14 * DAY_MS) {
    return { label: `${Math.max(1, Math.round(remain / DAY_MS))} 天后重置`, detail }
  }
  return { label: `${formatResetShort(at)} 重置`, detail }
}

function formatResetAbsolute(at: number): string {
  const parts = dateParts(at, { year: true })
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`
}

function formatResetShort(at: number): string {
  const parts = dateParts(at, { year: false })
  return `${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`
}

function dateParts(at: number, options: { year: boolean }) {
  const values: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('zh-CN', {
    ...(options.year ? { year: 'numeric' as const } : {}),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at))) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  const rawHour = Number(values.hour)
  return {
    year: values.year ?? '',
    month: String(Number(values.month)),
    day: String(Number(values.day)),
    hour: Number.isFinite(rawHour) ? String(rawHour % 24).padStart(2, '0') : (values.hour ?? ''),
    minute: values.minute ?? '',
  }
}
