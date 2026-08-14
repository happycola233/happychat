import { clsx } from 'clsx'
import { Gift, Infinity as InfinityIcon, PauseCircle } from 'lucide-react'
import type { MyQuotaDTO, QuotaBucketUsageDTO } from '@shared/types/api'
import { formatQuotaAmount } from '@shared/util/quota'
import { describeQuotaWindow } from '@shared/util/quotaWindow'

/** 进度条配色跟随「剩余程度」这一状态语义：正常 sky、接近上限 amber、已耗尽 rose。 */
function barTone(rule: QuotaBucketUsageDTO, warnThreshold: number) {
  if (rule.blocked) return 'bg-rose-500 dark:bg-rose-400'
  if ((rule.percent ?? 0) >= warnThreshold) return 'bg-amber-500 dark:bg-amber-400'
  return 'bg-sky-500 dark:bg-sky-400'
}

function ruleTitle(rule: QuotaBucketUsageDTO): string {
  const metric = rule.metric === 'cost' ? '消费' : '请求'
  const scope = rule.bucketLabel
    ? rule.bucketLabel
    : rule.scope.type === 'all'
      ? '全部模型'
      : rule.scope.type === 'models'
        ? '指定模型'
        : '指定分组'
  return `${describeQuotaWindow(rule.window)}${metric} · ${scope}`
}

function resetHint(rule: QuotaBucketUsageDTO): string | null {
  if (rule.window.type === 'total') return '永久累计，不会重置'
  if (rule.periodEnd === null) return '滚动窗口，随时间自动释放'
  return `${new Date(rule.periodEnd).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} 重置`
}

function QuotaRuleRow({ rule, warnThreshold }: { rule: QuotaBucketUsageDTO; warnThreshold: number }) {
  const unlimited = rule.limit.kind === 'unlimited'
  const percent = Math.min(100, Math.round((rule.percent ?? 0) * 100))
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-100">
          {rule.label || ruleTitle(rule)}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {unlimited ? (
            <span className="inline-flex items-center gap-1 text-neutral-400 dark:text-neutral-500">
              <InfinityIcon className="h-3.5 w-3.5" /> 无限额度
            </span>
          ) : (
            <>
              {formatQuotaAmount(rule.metric, rule.used)}
              <span className="text-neutral-300 dark:text-neutral-600"> / </span>
              {formatQuotaAmount(rule.metric, rule.effectiveLimit ?? 0)}
            </>
          )}
        </span>
      </div>
      {/* 无限额度显式渲染为一条虚线轨道，而不是「满格」或「空格」进度条——两者都会被误读。 */}
      {unlimited ? (
        <div className="mt-2 h-1.5 rounded-full border border-dashed border-neutral-200 dark:border-neutral-700" />
      ) : (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div
            className={clsx('h-full rounded-full transition-[width] duration-300', barTone(rule, warnThreshold))}
            style={{ width: `${Math.max(percent > 0 ? 2 : 0, percent)}%` }}
          />
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400 dark:text-neutral-500">
        {!unlimited && <span>{ruleTitle(rule)}</span>}
        <span>{resetHint(rule)}</span>
        {rule.granted > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Gift className="h-3 w-3" />
            含临时额度 {formatQuotaAmount(rule.metric, rule.granted)}
            {rule.grants[0]?.expiresAt
              ? `（${new Date(rule.grants[0].expiresAt).toLocaleDateString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                })} 失效）`
              : ''}
          </span>
        )}
        {rule.usageStart > rule.periodStart && (
          <span>
            已于{' '}
            {new Date(rule.usageStart).toLocaleString('zh-CN', {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}{' '}
            由管理员重置
          </span>
        )}
        {rule.invalid && <span className="text-rose-500 dark:text-rose-400">规则目标已不存在</span>}
      </div>
    </div>
  )
}

/**
 * 我的额度卡片。仅在开启限额时渲染（关闭时用户完全看不到限额的存在）。
 * 「无限额度」是一个显式状态，不用一个很大的数字模拟。
 */
export function QuotaProgressCard({ quota }: { quota: MyQuotaDTO }) {
  if (!quota.enabled) return null

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">我的额度</h2>
        <div className="flex items-center gap-2 text-[11px] text-neutral-400 dark:text-neutral-500">
          {quota.policyName && <span>策略：{quota.policyName}</span>}
          {quota.paused && (
            <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
              <PauseCircle className="h-3 w-3" /> 限额已暂停
            </span>
          )}
        </div>
      </div>

      {quota.unlimited || quota.rules.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl bg-neutral-50 px-3 py-4 text-sm text-neutral-500 dark:bg-neutral-800/50 dark:text-neutral-400">
          <InfinityIcon className="h-4 w-4 text-neutral-400 dark:text-neutral-500" />
          当前账号为无限额度，不受用量限制。
        </div>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {quota.rules.map((rule) => (
            <QuotaRuleRow
              key={`${rule.ruleId}:${rule.bucketKey ?? ''}`}
              rule={rule}
              warnThreshold={quota.warnThreshold}
            />
          ))}
        </div>
      )}

      {quota.paused && (
        <p className="mt-3 text-[11px] leading-5 text-neutral-400 dark:text-neutral-500">
          管理员已暂停对你的限额检查：期间用量仍照常统计，恢复后会按累计用量重新判定。
        </p>
      )}
    </div>
  )
}
