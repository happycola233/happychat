import { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import type { RunRetryData } from '@shared/types/events'

export function RetryStatus({ retry }: { retry: RunRetryData }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (retry.phase !== 'waiting') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [retry.phase, retry.nextRetryAt])
  const seconds = Math.max(0, Math.ceil(((retry.nextRetryAt ?? now) - now) / 1000))
  const waiting = retry.phase === 'waiting'
  return (
    <div
      className="flex max-w-lg items-start gap-3 rounded-2xl bg-amber-50/70 px-4 py-3 dark:bg-amber-950/20"
      role="status"
    >
      <RotateCw
        className={`mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 ${!waiting ? 'motion-safe:animate-spin' : ''}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {waiting ? retry.reason : '正在重新连接'}
          </span>
          <span className="text-xs text-amber-700 tabular-nums dark:text-amber-400">
            重试 {retry.attempt - 1} / {retry.maxAttempts - 1}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          {waiting
            ? seconds > 0
              ? `${seconds} 秒后继续尝试。`
              : '即将继续尝试。'
            : '已重新发送请求，正在等待响应。'}
          可以先离开此页面，稍后回到对话查看结果。
        </p>
      </div>
    </div>
  )
}
