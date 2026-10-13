import { useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import type { RunRetryData } from '@shared/types/events'
import { runErrorMetaParts } from './runErrorAdvice'

/** 自动重试进度：说明上一次为什么失败、何时再试，以及已有内容会如何处理。 */
export function RetryStatus({ retry }: { retry: RunRetryData }) {
  const waiting = retry.phase === 'waiting'
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [waiting, retry.nextRetryAt])

  const afterOutput = retry.stage === 'after_output'
  const failure = retry.lastFailure
  const seconds = Math.max(0, Math.ceil(((retry.nextRetryAt ?? now) - now) / 1000))
  const title = waiting
    ? seconds > 0
      ? `${afterOutput ? '回答中断' : '生成未成功'}，${seconds} 秒后${afterOutput ? '重新生成' : '自动重试'}`
      : afterOutput
        ? '即将重新生成'
        : '即将自动重试'
    : afterOutput
      ? '正在重新生成'
      : '正在自动重试'
  // 进度条表示距离下一次尝试的等待；旧事件缺少失败时间时只显示倒计时文字。
  const waitProgress =
    failure && retry.nextRetryAt && retry.nextRetryAt > failure.failedAt
      ? Math.min(1, Math.max(0, (now - failure.failedAt) / (retry.nextRetryAt - failure.failedAt)))
      : null
  const meta = failure ? runErrorMetaParts(failure) : []

  return (
    <div
      className="flex items-start gap-3 rounded-2xl bg-amber-50/70 px-4 py-3 ring-1 ring-inset ring-amber-200/60 dark:bg-amber-950/20 dark:ring-amber-900/40"
      role="status"
      data-testid="retry-status"
    >
      <RotateCw
        aria-hidden
        className={`mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 ${!waiting ? 'motion-safe:animate-spin' : ''}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          {/* 倒计时每秒变化，读屏只播报不含秒数的状态，避免逐秒打断。 */}
          <span
            className="text-sm font-medium text-neutral-800 tabular-nums dark:text-neutral-200"
            aria-hidden
          >
            {title}
          </span>
          <span className="sr-only">
            {waiting
              ? afterOutput
                ? '回答中断，稍后重新生成'
                : '生成未成功，稍后自动重试'
              : title}
          </span>
          <span className="text-xs text-amber-700 tabular-nums dark:text-amber-400">
            第 {retry.attempt - 1}/{retry.maxAttempts - 1} 次重试
          </span>
        </div>
        {failure && (
          <p className="mt-1 break-words text-[13px] leading-5 text-neutral-600 dark:text-neutral-300">
            {!waiting && '上次失败：'}
            {failure.message}
            {meta.length > 0 && (
              <span className="ml-1.5 break-all text-xs text-neutral-500 dark:text-neutral-400">
                {meta.join(' · ')}
              </span>
            )}
          </p>
        )}
        {waiting && waitProgress !== null && (
          <div
            aria-hidden
            className="mt-2 h-1 overflow-hidden rounded-full bg-amber-200/60 dark:bg-amber-900/40"
          >
            <div
              className="h-full origin-left rounded-full bg-amber-500 transition-transform duration-1000 ease-linear motion-reduce:transition-none dark:bg-amber-400"
              style={{ transform: `scaleX(${waitProgress})` }}
            />
          </div>
        )}
        <p className="mt-1.5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          {!waiting && '已重新发送请求，正在等待回复。'}
          {afterOutput && '已生成的内容会先保留，新的回答开始后再替换。'}
          离开此页面不会中断重试。
        </p>
      </div>
    </div>
  )
}
