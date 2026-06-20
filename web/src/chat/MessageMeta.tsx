import { useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { ArrowDown, ArrowUp, Check, Clock, Copy, Zap } from 'lucide-react'
import type { MessageUsage } from '@shared/types/domain'
import { copyToClipboard } from '../lib/clipboard'
import { toast } from '../store/toast'
import { computeTps, formatDuration, formatMessageTime, formatTokens, formatTps } from './usageFormat'

export function MessageIconButton({
  title,
  onClick,
  children,
  disabled,
  className,
}: {
  title: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function CopyMessageButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const canCopy = text.trim().length > 0

  return (
    <MessageIconButton
      title={canCopy ? '复制' : '无可复制文本'}
      disabled={!canCopy}
      className={className}
      onClick={() => {
        void copyToClipboard(text)
          .then((ok) => {
            if (!ok) throw new Error('copy failed')
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => toast.error('复制失败'))
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </MessageIconButton>
  )
}

export function MessageTimeLabel({
  ts,
  format,
  className,
}: {
  ts: number
  format: 'time' | 'datetime'
  className?: string
}) {
  return (
    <span className={clsx('text-xs tabular-nums text-neutral-400', className)}>
      {formatMessageTime(ts, format)}
    </span>
  )
}

/** 助手消息用量明细：输入(缓存) / 输出 / tok·s / 耗时。 */
export function MessageUsageStats({
  usage,
  durationMs,
  className,
}: {
  usage: MessageUsage
  durationMs: number | null
  className?: string
}) {
  const tps = computeTps(usage.outputTokens, durationMs)
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        <ArrowUp className="h-3 w-3" />
        {formatTokens(usage.inputTokens)} tokens
        {usage.cachedTokens > 0 && <span>（{formatTokens(usage.cachedTokens)} 缓存）</span>}
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowDown className="h-3 w-3" />
        {formatTokens(usage.outputTokens)} tokens
      </span>
      {tps !== null && (
        <span className="inline-flex items-center gap-1">
          <Zap className="h-3 w-3" />
          {formatTps(tps)} tok/s
        </span>
      )}
      {durationMs !== null && durationMs > 0 && (
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(durationMs)}
        </span>
      )}
    </div>
  )
}
