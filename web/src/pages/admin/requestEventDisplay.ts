function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.?0+$/, '')
}

/** 请求事件时间按本地时区拆成两行，便于纵向扫读。 */
export function formatRequestEventTimestamp(timestamp: number): {
  time: string
  date: string
} {
  const date = new Date(timestamp)
  return {
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
    date: `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`,
  }
}

/** 请求监控中的延时保留到百分之一秒，并去掉无意义的末尾零。 */
export function formatRequestLatency(durationMs: number | null): string {
  if (durationMs === null) return '-'
  if (durationMs < 60_000) return `${trimFixed(durationMs / 1000, 2)}秒`
  const roundedSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(roundedSeconds / 60)
  return `${minutes}分钟 ${pad2(roundedSeconds % 60)}秒`
}

export function formatGenerationSpeed(tokensPerSecond: number | null): string {
  return tokensPerSecond === null ? '-' : `${tokensPerSecond.toFixed(1)} t/s`
}

export function formatCacheRate(cachedTokens: number, inputTokens: number): string {
  return inputTokens > 0 ? `${((cachedTokens / inputTokens) * 100).toFixed(2)}%` : '-'
}
