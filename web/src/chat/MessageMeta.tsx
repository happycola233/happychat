import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { ArrowDown, ArrowUp, Check, Clock, Coins, Zap } from 'lucide-react'
import type { MessageCostDisplayDTO } from '@shared/types/api'
import type { MessageUsage } from '@shared/types/domain'
import { copyToClipboard } from '../lib/clipboard'
import { toast } from '../store/toast'
import {
  computeTps,
  formatMessageCost,
  formatDuration,
  formatMessageTime,
  formatTokens,
  formatTps,
} from './usageFormat'
import { CopyIcon } from './icons'

export function MessageIconButton({
  title,
  onClick,
  children,
  disabled,
  className,
  testId,
  ariaBusy,
}: {
  title: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  className?: string
  testId?: string
  ariaBusy?: boolean
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-busy={ariaBusy || undefined}
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
      {copied ? (
        <Check className="h-[18px] w-[18px]" />
      ) : (
        <CopyIcon className="h-[18px] w-[18px]" />
      )}
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

/** 助手消息用量明细：输入（缓存写入/读取）/ 输出 / tok·s / 耗时 / 可选成本。 */
export function MessageUsageStats({
  usage,
  durationMs,
  costUsd,
  costDisplay,
  className,
}: {
  usage: MessageUsage
  durationMs: number | null
  costUsd?: number | null
  costDisplay?: MessageCostDisplayDTO
  className?: string
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [omitTokenUnits, setOmitTokenUnits] = useState(false)
  const tps = computeTps(usage.outputTokens, durationMs)
  const formattedCost = formatMessageCost(costUsd, costDisplay)
  // 兼容功能上线前创建的公开分享快照，其 usage JSON 没有 cacheWriteTokens。
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0
  const cacheDetails = [
    cacheWriteTokens > 0 ? `写入 ${formatTokens(cacheWriteTokens)}` : null,
    usage.cachedTokens > 0 ? `读取 ${formatTokens(usage.cachedTokens)}` : null,
  ].filter((value): value is string => value !== null)

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row || typeof ResizeObserver === 'undefined') return

    const measureExpandedRow = () => {
      const tokenUnits = row.querySelectorAll<HTMLElement>('[data-token-unit]')
      const previousFlexWrap = row.style.flexWrap
      const previousDisplays = Array.from(tokenUnits, (unit) => unit.style.display)

      // 同步临时恢复完整文案并禁止换行，以测得「带 tokens 是否能放进一行」。
      // 测量结束立即还原样式，不会改变用户实际看到的布局。
      row.style.flexWrap = 'nowrap'
      tokenUnits.forEach((unit) => {
        unit.style.display = 'inline'
      })
      const shouldOmit = row.scrollWidth > row.clientWidth + 1
      row.style.flexWrap = previousFlexWrap
      tokenUnits.forEach((unit, index) => {
        unit.style.display = previousDisplays[index] ?? ''
      })

      setOmitTokenUnits(shouldOmit)
    }

    measureExpandedRow()
    const observer = new ResizeObserver(measureExpandedRow)
    observer.observe(row)
    return () => observer.disconnect()
  }, [
    cacheWriteTokens,
    durationMs,
    formattedCost?.value,
    usage.cachedTokens,
    usage.inputTokens,
    usage.outputTokens,
  ])

  return (
    <div
      ref={rowRef}
      className={clsx(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs whitespace-nowrap text-neutral-400',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1" title="输入 Token 数">
        <ArrowUp className="h-3 w-3" />
        <span>
          {formatTokens(usage.inputTokens)}
          <span data-token-unit className={omitTokenUnits ? 'hidden' : undefined}>
            {' '}tokens
          </span>
          {cacheDetails.length > 0 && `（缓存${cacheDetails.join(' · ')}）`}
        </span>
      </span>
      <span className="inline-flex items-center gap-1" title="输出 Token 数">
        <ArrowDown className="h-3 w-3" />
        <span>
          {formatTokens(usage.outputTokens)}
          <span data-token-unit className={omitTokenUnits ? 'hidden' : undefined}>
            {' '}tokens
          </span>
        </span>
      </span>
      {tps !== null && (
        <span className="inline-flex items-center gap-1" title="生成速度（Token/s）">
          <Zap className="h-3 w-3" />
          {formatTps(tps)} tok/s
        </span>
      )}
      {durationMs !== null && durationMs > 0 && (
        <span className="inline-flex items-center gap-1" title="本次请求耗时">
          <Clock className="h-3 w-3" />
          {formatDuration(durationMs)}
        </span>
      )}
      {formattedCost && (
        <span className="inline-flex items-center gap-1" title={formattedCost.title}>
          <Coins className="h-3 w-3" />
          {formattedCost.value}
        </span>
      )}
    </div>
  )
}
