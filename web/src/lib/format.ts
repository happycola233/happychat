import { getBillingCurrency } from '../store/billingCurrency'
import type { CostCurrency } from '@shared/types/domain'
/** 紧凑数字：1234→1.2K、1_200_000→1.2M。 */
export function formatCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  if (abs < 1e6) return trim1(n / 1e3) + 'K'
  if (abs < 1e9) return trim1(n / 1e6) + 'M'
  return trim1(n / 1e9) + 'B'
}

function trim1(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '')
}

/** 耗时：<1s→"0.2s"、<10s→"5.4s"、<60s→"31s"、否则"1m 05s"。 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec < 10 ? trim1(totalSec) : Math.round(totalSec)}s`
  const roundedSeconds = Math.round(totalSec)
  const m = Math.floor(roundedSeconds / 60)
  const s = roundedSeconds % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

/** 统计金额已经由服务端换算；这里只负责币种符号与小额精度。 */
export function formatCurrency(n: number, currency: CostCurrency = getBillingCurrency()): string {
  const symbol = currency === 'CNY' ? '¥' : '$'
  if (!n) return symbol + '0'
  if (n < 0.000001) return '<' + symbol + '0.000001'
  return (
    symbol +
    n.toLocaleString('zh-CN', {
      minimumFractionDigits: n >= 1 ? 2 : 0,
      maximumFractionDigits: n < 0.01 ? 6 : n < 1 ? 4 : 2,
    })
  )
}

export function formatPercent(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

export function formatInt(n: number): string {
  return n.toLocaleString('zh-CN')
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

/** 短日期（同年省略年份），用于分享有效期等紧凑场景。 */
export function formatShortDate(ts: number): string {
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('zh-CN', {
    ...(sameYear ? {} : { year: 'numeric' as const }),
    month: 'long',
    day: 'numeric',
  })
}

/** 时间轴刻度：按天显示 MM-DD，按时显示 HH:mm。 */
export function formatBucketTick(
  ts: number,
  bucket: 'hour' | 'day' | 'month',
  timeZone?: string,
): string {
  const d = new Date(ts)
  if (bucket === 'month')
    return d.toLocaleDateString('zh-CN', { timeZone, year: '2-digit', month: 'short' })
  return bucket === 'day'
    ? d.toLocaleDateString('zh-CN', { timeZone, month: '2-digit', day: '2-digit' })
    : d.toLocaleTimeString('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 通用相对时间（最近使用、最近登录等），具体业务语义由调用方命名。 */
export function formatRelative(ts: number | null): string {
  if (!ts) return '从未'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}
