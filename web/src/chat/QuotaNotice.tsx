import { useState } from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { AlertTriangle, CircleSlash, PauseCircle, X } from 'lucide-react'
import type { QuotaBucketUsageDTO } from '@shared/types/api'
import { formatQuotaAmount } from '@shared/util/quota'
import { describeQuotaWindow } from '@shared/util/quotaWindow'
import { describeQuotaReset } from '../lib/quotaResetDisplay'
import { useMyQuota, resolveQuotaNotice, type QuotaNoticeLevel } from '../hooks/useQuota'
import { useChatPrefs } from '../store/chat'
import { quotaWarningDismissKey } from './quotaNoticeDismissal'

/** 各状态的配色与图标；浅/深色分别取足够的对比又不抢过输入框。 */
const LEVEL_STYLES: Record<
  Exclude<QuotaNoticeLevel, 'none'>,
  { icon: typeof AlertTriangle; surface: string; accent: string }
> = {
  warning: {
    icon: AlertTriangle,
    surface:
      'border-amber-200/80 bg-amber-50/90 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100',
    accent: 'text-amber-500 dark:text-amber-300',
  },
  exhausted: {
    icon: CircleSlash,
    surface:
      'border-rose-200/80 bg-rose-50/90 text-rose-900 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-100',
    accent: 'text-rose-500 dark:text-rose-300',
  },
  'model-exhausted': {
    icon: CircleSlash,
    surface:
      'border-rose-200/80 bg-rose-50/90 text-rose-900 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-100',
    accent: 'text-rose-500 dark:text-rose-300',
  },
  paused: {
    icon: PauseCircle,
    surface:
      'border-sky-200/80 bg-sky-50/90 text-sky-900 dark:border-sky-400/25 dark:bg-sky-500/10 dark:text-sky-100',
    accent: 'text-sky-500 dark:text-sky-300',
  },
}

/** 「本月消费 $9.20 / $10.00」这类用量短语。 */
function usagePhrase(rule: QuotaBucketUsageDTO): string {
  const scope = rule.bucketLabel ? `${rule.bucketLabel} ` : ''
  const metric = rule.metric === 'cost' ? '消费' : '请求'
  const used = formatQuotaAmount(rule.metric, rule.used)
  const limit = formatQuotaAmount(rule.metric, rule.effectiveLimit ?? 0)
  return `${scope}${describeQuotaWindow(rule.window)}${metric} ${used} / ${limit}`
}

function noticeText(level: Exclude<QuotaNoticeLevel, 'none'>, rule: QuotaBucketUsageDTO): string {
  const reset = describeQuotaReset(rule)
  const resetText = reset?.kind === 'scheduled' ? reset.label : null
  const usage = usagePhrase(rule)
  if (level === 'warning') {
    return `额度即将用尽：${usage}${resetText ? `，${resetText}` : ''}`
  }
  if (level === 'model-exhausted') {
    return `当前模型额度已用尽：${usage}${resetText ? `，${resetText}` : ''}。可切换到其他仍有额度的模型继续对话。`
  }
  if (level === 'paused') {
    return `额度已超出上限（${usage}），但管理员已暂停限额，当前仍可正常使用。`
  }
  return `额度已用尽：${usage}${resetText ? `，${resetText}` : ''}。请联系管理员调整额度。`
}

/**
 * 输入框上方的额度提示条。
 *
 * 由 `Composer` 的 `notice` 插槽渲染在视觉盒上方（且位于 Composer 根节点内），
 * 因此它会自动计入 Composer 上报的高度，底部遮罩与「滚动到底部」按钮的位置无需另行调整。
 *
 * 「接近上限」可手动关闭：整段周期按稳定周期起点记忆；滚动窗口没有稳定起点，
 * 因而按「规则 + 桶 + 窗口配置」在当前标签页内记忆。已耗尽/暂停两态不可关闭。
 */
export function QuotaNotice() {
  const { data: quota } = useMyQuota()
  const activeModelId = useChatPrefs((s) => s.activeModelId)
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => readDismissed())
  const { level, rule } = resolveQuotaNotice(quota, activeModelId)

  if (level === 'none' || !rule) return null
  const key = quotaWarningDismissKey(rule)
  const dismissible = level === 'warning'
  if (dismissible && dismissedKey === key) return null

  const style = LEVEL_STYLES[level]
  const Icon = style.icon
  return (
    <div className="pointer-events-auto px-1 pb-2">
      <div
        role={level === 'warning' ? undefined : 'alert'}
        className={clsx(
          'hc-anim-in flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px] leading-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] backdrop-blur-sm',
          style.surface,
        )}
      >
        <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', style.accent)} />
        <span className="min-w-0 flex-1">{noticeText(level, rule)}</span>
        <Link
          to="/usage"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium underline-offset-2 transition hover:underline"
        >
          使用情况
        </Link>
        {dismissible && (
          <button
            type="button"
            aria-label="暂不提示"
            onClick={() => {
              writeDismissed(key)
              setDismissedKey(key)
            }}
            className="shrink-0 rounded-md p-0.5 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
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
