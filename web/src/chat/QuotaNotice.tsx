import { useState } from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { AlertTriangle, ChevronRight, CircleSlash, Clock3, PauseCircle, X } from 'lucide-react'
import type { QuotaBucketUsageDTO } from '@shared/types/api'
import { formatQuotaAmount, formatQuotaTargetLabels } from '@shared/util/quota'
import { describeQuotaWindow } from '@shared/util/quotaWindow'
import { describeQuotaReset, type QuotaResetDisplay } from '../lib/quotaResetDisplay'
import { useMyQuota, resolveQuotaNotice, type QuotaNoticeLevel } from '../hooks/useQuota'
import { useChatPrefs } from '../store/chat'
import { quotaWarningDismissKey } from './quotaNoticeDismissal'

type NoticeLevel = Exclude<QuotaNoticeLevel, 'none'>

/** 极淡的状态色轮廓区分聊天正文，图标与进度保留主要视觉强调。 */
const LEVEL_STYLES: Record<
  NoticeLevel,
  { icon: typeof AlertTriangle; color: string; bar: string; ring: string }
> = {
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-600 dark:text-amber-300',
    bar: 'bg-amber-500 dark:bg-amber-400',
    ring: 'ring-amber-500/25 dark:ring-amber-400/20',
  },
  exhausted: {
    icon: CircleSlash,
    color: 'text-rose-600 dark:text-rose-300',
    bar: 'bg-rose-500 dark:bg-rose-400',
    ring: 'ring-rose-500/20 dark:ring-rose-400/20',
  },
  'model-exhausted': {
    icon: CircleSlash,
    color: 'text-rose-600 dark:text-rose-300',
    bar: 'bg-rose-500 dark:bg-rose-400',
    ring: 'ring-rose-500/20 dark:ring-rose-400/20',
  },
  paused: {
    icon: PauseCircle,
    color: 'text-sky-600 dark:text-sky-300',
    bar: 'bg-sky-500 dark:bg-sky-400',
    ring: 'ring-sky-500/20 dark:ring-sky-400/20',
  },
}

function noticeTitle(level: NoticeLevel): string {
  if (level === 'warning') return '额度即将用尽'
  if (level === 'model-exhausted') return '当前模型额度已用尽'
  if (level === 'paused') return '额度已超出上限'
  return '额度已用尽'
}

/** 将周期与计量合成短语，例如「首次请求起 5 小时消费」。 */
function windowPhrase(rule: QuotaBucketUsageDTO): string {
  const metric = rule.metric === 'cost' ? '消费' : '请求'
  return `${describeQuotaWindow(rule.window)}${metric}`
}

function usageFigures(rule: QuotaBucketUsageDTO): { used: string; limit: string } {
  return {
    used: formatQuotaAmount(rule.metric, rule.used),
    limit: formatQuotaAmount(rule.metric, rule.effectiveLimit ?? 0),
  }
}

function barPercent(rule: QuotaBucketUsageDTO): number {
  const percent = Math.min(100, Math.round((rule.percent ?? 0) * 100))
  return Math.max(percent > 0 ? 2 : 0, percent)
}

function ResetLabel({ reset }: { reset: QuotaResetDisplay }) {
  const scheduled = reset.kind === 'scheduled'
  return (
    <span
      title={reset.detail}
      aria-label={reset.detail ? `${reset.label}（${reset.detail}）` : reset.label}
      className="inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400"
    >
      {(scheduled || reset.kind === 'pending') && <Clock3 className="h-3 w-3" />}
      {reset.label}
    </span>
  )
}

/**
 * 输入框上方的额度提示条。
 *
 * 由 `Composer` 的 `notice` 插槽渲染在视觉盒上方（且位于 Composer 根节点内），
 * 因此它会自动计入 Composer 上报的高度，底部遮罩与「滚动到底部」按钮的位置无需另行调整。
 *
 * 「接近上限」和「限额已暂停」可手动关闭：整段周期按稳定周期起点记忆；滚动窗口
 * 没有稳定起点，因而按「规则 + 桶 + 窗口配置」在当前标签页内记忆。关闭键带上状态，
 * 关掉预警不会把之后的暂停说明一并藏掉。已耗尽不可关闭。
 */
export function QuotaNotice() {
  const { data: quota } = useMyQuota()
  const activeModelId = useChatPrefs((s) => s.activeModelId)
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => readDismissed())
  const { level, rule } = resolveQuotaNotice(quota, activeModelId)

  if (level === 'none' || !rule) return null
  const dismissible = level === 'warning' || level === 'paused'
  const key = `${level}:${quotaWarningDismissKey(rule)}:${level === 'warning' ? (quota?.warningMessage ?? '') : ''}`
  if (dismissible && dismissedKey === key) return null

  const style = LEVEL_STYLES[level]
  const Icon = style.icon
  const reset = describeQuotaReset(rule)
  const figures = usageFigures(rule)
  const hint =
    level === 'warning'
      ? quota?.warningMessage?.trim()
      : level === 'paused'
        ? null
        : quota?.exhaustedMessage?.trim()
  const scope = rule.bucketLabel ?? formatQuotaTargetLabels(rule.targetLabels)

  return (
    <div className="pointer-events-auto pb-3">
      <div
        role={level === 'exhausted' || level === 'model-exhausted' ? 'alert' : undefined}
        // 不透明底色遮住滚动正文，细轮廓和轻阴影让提示独立于聊天与输入框。
        className={clsx(
          'hc-anim-in rounded-2xl bg-white px-4 py-3 text-neutral-800 ring-1 ring-inset shadow-[0_3px_14px_-8px_rgba(0,0,0,0.24)] dark:bg-[#111111] dark:text-neutral-100 dark:shadow-[0_3px_14px_-6px_rgba(0,0,0,0.5)]',
          style.ring,
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={clsx(
              'mt-0.5 flex h-5 w-4 shrink-0 items-center justify-center',
              style.color,
            )}
          >
            <Icon className="h-4 w-4" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <p className="text-[13px] leading-5 font-medium">{noticeTitle(level)}</p>
                  {level === 'model-exhausted' && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      可切换模型
                    </span>
                  )}
                  {level === 'paused' && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      限额已暂停，仍可使用
                    </span>
                  )}
                </div>
              </div>

              <div className="-mr-0.5 -mt-0.5 flex shrink-0 items-center">
                <Link
                  to="/usage"
                  className="inline-flex h-7 items-center gap-0.5 rounded-lg px-2 text-[12px] font-medium text-neutral-600 transition hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50 dark:text-neutral-300 dark:hover:bg-white/10"
                >
                  使用情况
                  <ChevronRight className="h-3.5 w-3.5 opacity-50" />
                </Link>
                {dismissible && (
                  <button
                    type="button"
                    aria-label="暂不提示"
                    onClick={() => {
                      writeDismissed(key)
                      setDismissedKey(key)
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-black/[0.05] hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50 dark:hover:bg-white/10 dark:hover:text-neutral-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {hint && (
              <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                {hint}
              </p>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
              <span className="inline-flex items-center gap-2">
                <span className="whitespace-nowrap tabular-nums">
                  已用 {figures.used}
                  <span className="mx-1 opacity-50">/</span>
                  {figures.limit}
                </span>
                <span
                  aria-hidden="true"
                  className="inline-flex h-0.5 w-12 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10"
                >
                  <span
                    className={clsx(
                      'h-full rounded-full transition-[width] duration-300',
                      style.bar,
                    )}
                    style={{ width: `${barPercent(rule)}%` }}
                  />
                </span>
                <span className="tabular-nums">{Math.round((rule.percent ?? 0) * 100)}%</span>
              </span>
              {reset && <ResetLabel reset={reset} />}
              <span
                className="min-w-0 truncate text-neutral-400 dark:text-neutral-500"
                title={scope || undefined}
              >
                {scope ? `${scope} · ` : ''}
                {windowPhrase(rule)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const DISMISS_STORAGE_KEY = 'happychat-quota-warn-dismissed'

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeDismissed(key: string): void {
  try {
    sessionStorage.setItem(DISMISS_STORAGE_KEY, key)
  } catch {
    // 隐私模式下 sessionStorage 可能不可用：关闭仅在本次渲染生效即可
  }
}
