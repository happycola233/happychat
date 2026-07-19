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

/** 美元成本：0→$0、极小→<$0.01、其余按量级保留 2-3 位。 */
export function formatUsd(n: number): string {
  if (!n) return '$0'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(n < 1 ? 3 : 2)
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
export function formatBucketTick(ts: number, bucket: 'hour' | 'day'): string {
  const d = new Date(ts)
  return bucket === 'day'
    ? d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 相对时间（最近活跃等）。 */
export function formatRelative(ts: number | null): string {
  if (!ts) return '从未'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}
