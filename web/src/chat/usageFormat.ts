function trim1(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '')
}

// 通用时长格式放在 lib 中；保留此导出，避免聊天组件的领域格式入口分裂。
export { formatDuration } from '../lib/format'

/** 紧凑显示 token 数：3100→"3.1K"、16→"16"、1_200_000→"1.2M"。 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k >= 100 ? Math.round(k) : trim1(k)}K`
  }
  const m = n / 1_000_000
  return `${m >= 100 ? Math.round(m) : trim1(m)}M`
}

/** 生成速度 tok/s = 输出 token / 生成秒数；数据不足时返回 null。 */
export function computeTps(outputTokens: number, durationMs: number | null): number | null {
  if (!durationMs || durationMs <= 0 || outputTokens <= 0) return null
  return outputTokens / (durationMs / 1000)
}

export function formatTps(tps: number): string {
  return tps >= 100 ? String(Math.round(tps)) : trim1(tps)
}

/** 消息时间显示：'time'=HH:mm；'datetime'=YYYY/MM/DD HH:mm（均 24 小时制）。 */
export function formatMessageTime(ts: number, format: 'time' | 'datetime' = 'time'): string {
  const d = new Date(ts)
  if (format === 'datetime') {
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
