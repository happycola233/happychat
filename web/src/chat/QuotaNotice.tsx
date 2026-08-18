import { useState } from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { AlertTriangle, ChevronRight, CircleSlash, Clock3, PauseCircle, X } from 'lucide-react'
import type { QuotaBucketUsageDTO } from '@shared/types/api'
import { formatQuotaAmount } from '@shared/util/quota'
import { describeQuotaWindow } from '@shared/util/quotaWindow'
import { describeQuotaReset, type QuotaResetDisplay } from '../lib/quotaResetDisplay'
import { useMyQuota, resolveQuotaNotice, type QuotaNoticeLevel } from '../hooks/useQuota'
import { useChatPrefs } from '../store/chat'
import { quotaWarningDismissKey } from './quotaNoticeDismissal'

type NoticeLevel = Exclude<QuotaNoticeLevel, 'none'>

/** 卡片跟输入框同一套不透明表面：浅色纯白、深色 #212121，不透出底下聊天。 */
const SURFACE =
  'border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_18px_rgba(0,0,0,0.045)] dark:border-[#303030] dark:bg-[#212121] dark:shadow-none'

/** 状态色只落在图标井、进度条和重置芯片，整卡不再铺警示底。 */
const LEVEL_STYLES: Record<
  NoticeLevel,
  { icon: typeof AlertTriangle; well: string; bar: string; chip: string }
> = {
  warning: {
    icon: AlertTriangle,
    well: 'bg-amber-100 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300',
    bar: 'bg-amber-500 dark:bg-amber-400',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
  },
  exhausted: {
    icon: CircleSlash,
    well: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    bar: 'bg-rose-500 dark:bg-rose-400',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
  'model-exhausted': {
    icon: CircleSlash,
    well: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    bar: 'bg-rose-500 dark:bg-rose-400',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
  paused: {
    icon: PauseCircle,
    well: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
    bar: 'bg-sky-500 dark:bg-sky-400',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  },
}

function noticeTitle(level: NoticeLevel): string {
  if (level === 'warning') return '额度即将用尽'
  if (level === 'model-exhausted') return '当前模型额度已用尽'
  if (level === 'paused') return '额度已超出上限'
  return '额度已用尽'
}

function noticeHint(level: NoticeLevel): string | null {
  if (level === 'model-exhausted') return '可切换到其他仍有额度的模型继续对话。'
  if (level === 'paused') return '管理员已暂停限额，当前仍可正常使用。'
  if (level === 'exhausted') return '请联系管理员调整额度。'
  return null
}

/** 「首次请求起 5 小时消费」这类窗口 + 计量短语，单独成行便于扫读。 */
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

function ResetChip({ reset, chip }: { reset: QuotaResetDisplay; chip: string }) {
  const scheduled = reset.kind === 'scheduled'
  return (
    <span
      title={reset.detail}
      aria-label={reset.detail ? `${reset.label}（${reset.detail}）` : reset.label}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        scheduled ? chip : 'bg-neutral-100 text-neutral-500 dark:bg-white/8 dark:text-neutral-400',
      )}
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
  const key = `${level}:${quotaWarningDismissKey(rule)}`
  if (dismissible && dismissedKey === key) return null

  const style = LEVEL_STYLES[level]
  const Icon = style.icon
  const reset = describeQuotaReset(rule)
  const figures = usageFigures(rule)
  const hint = noticeHint(level)
  const scope = rule.bucketLabel

  return (
    <div className="pointer-events-auto pb-2">
      <div
        role={level === 'exhausted' || level === 'model-exhausted' ? 'alert' : undefined}
        className={clsx(
          'hc-anim-in rounded-[22px] border px-3 py-2.5 text-neutral-800 dark:text-neutral-100',
          SURFACE,
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={clsx(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]',
              style.well,
            )}
          >
            <Icon className="h-4 w-4" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <p className="text-[13px] leading-5 font-medium">{noticeTitle(level)}</p>
                  <p className="text-[13px] leading-5 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {figures.used}
                    <span className="text-neutral-300 dark:text-neutral-600"> / </span>
                    {figures.limit}
                  </p>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
                  {scope && (
                    <>
                      <span className="min-w-0 truncate">{scope}</span>
                      <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">
                        ·
                      </span>
                    </>
                  )}
                  <span>{windowPhrase(rule)}</span>
                  {reset && <ResetChip reset={reset} chip={style.chip} />}
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

            <div
              aria-hidden="true"
              className="mt-2 h-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10"
            >
              <div
                className={clsx('h-full rounded-full transition-[width] duration-300', style.bar)}
                style={{ width: `${barPercent(rule)}%` }}
              />
            </div>

            {hint && (
              <p className="mt-1.5 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
                {hint}
              </p>
            )}
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
