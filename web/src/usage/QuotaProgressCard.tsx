import { clsx } from 'clsx'
import { Clock3, Gift, Infinity as InfinityIcon, PauseCircle } from 'lucide-react'
import type { MyQuotaDTO, QuotaBucketUsageDTO } from '@shared/types/api'
import {
  describeQuotaRuleGroupTitle,
  formatQuotaAmount,
  groupQuotaBucketsByRule,
} from '@shared/util/quota'
import { describeQuotaWindow } from '@shared/util/quotaWindow'
import {
  describeQuotaReset,
  quotaResetKey,
  type QuotaResetDisplay,
} from '../lib/quotaResetDisplay'

/** 进度条配色跟随「剩余程度」这一状态语义：正常 sky、接近上限 amber、已耗尽 rose。 */
function barTone(rule: QuotaBucketUsageDTO, warnThreshold: number) {
  if (rule.blocked) return 'bg-rose-500 dark:bg-rose-400'
  if ((rule.percent ?? 0) >= warnThreshold) return 'bg-amber-500 dark:bg-amber-400'
  return 'bg-sky-500 dark:bg-sky-400'
}

function resetEmphasis(
  rule: QuotaBucketUsageDTO,
  warnThreshold: number,
): 'exhausted' | 'warning' | undefined {
  if (rule.blocked) return 'exhausted'
  if ((rule.percent ?? 0) >= warnThreshold) return 'warning'
  return undefined
}

function QuotaResetChip({
  reset,
  emphasize,
}: {
  reset: QuotaResetDisplay
  emphasize?: 'exhausted' | 'warning'
}) {
  const scheduled = reset.kind === 'scheduled'
  return (
    <span
      title={reset.detail}
      aria-label={reset.detail ? `${reset.label}（${reset.detail}）` : reset.label}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        scheduled && emphasize === 'exhausted'
          ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
          : scheduled && emphasize === 'warning'
            ? 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200'
            : scheduled
              ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
              : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
      )}
    >
      {(scheduled || reset.kind === 'pending') && <Clock3 className="h-3 w-3" />}
      {reset.label}
    </span>
  )
}

function QuotaBar({ rule, warnThreshold }: { rule: QuotaBucketUsageDTO; warnThreshold: number }) {
  const unlimited = rule.limit.kind === 'unlimited'
  const percent = Math.min(100, Math.round((rule.percent ?? 0) * 100))
  if (unlimited) {
    return (
      <div className="h-1.5 rounded-full border border-dashed border-neutral-200 dark:border-neutral-700" />
    )
  }
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
      <div
        className={clsx(
          'h-full rounded-full transition-[width] duration-300',
          barTone(rule, warnThreshold),
        )}
        style={{ width: `${Math.max(percent > 0 ? 2 : 0, percent)}%` }}
      />
    </div>
  )
}

function UsageFigure({ rule }: { rule: QuotaBucketUsageDTO }) {
  if (rule.limit.kind === 'unlimited') {
    return (
      <span className="inline-flex items-center gap-1 text-neutral-400 dark:text-neutral-500">
        <InfinityIcon className="h-3.5 w-3.5" /> 无限额度
      </span>
    )
  }
  return (
    <>
      {formatQuotaAmount(rule.metric, rule.used)}
      <span className="text-neutral-300 dark:text-neutral-600"> / </span>
      {formatQuotaAmount(rule.metric, rule.effectiveLimit ?? 0)}
    </>
  )
}

function QuotaFootnotes({
  rule,
  extras,
  reset,
  warnThreshold,
}: {
  rule: QuotaBucketUsageDTO
  extras?: Array<string | null>
  reset?: QuotaResetDisplay | null
  warnThreshold?: number
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400 dark:text-neutral-500">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {extras?.filter(Boolean).map((item) => (
          <span key={item}>{item}</span>
        ))}
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
        {rule.limit.kind !== 'unlimited' && rule.usageStart > rule.periodStart && (
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
      {reset && (
        <QuotaResetChip
          reset={reset}
          emphasize={warnThreshold === undefined ? undefined : resetEmphasis(rule, warnThreshold)}
        />
      )}
    </div>
  )
}

function SingleQuotaRow({
  rule,
  warnThreshold,
}: {
  rule: QuotaBucketUsageDTO
  warnThreshold: number
}) {
  const reset = describeQuotaReset(rule)
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-100">
          {describeQuotaRuleGroupTitle([rule])}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          <UsageFigure rule={rule} />
        </span>
      </div>
      <div className="mt-2">
        <QuotaBar rule={rule} warnThreshold={warnThreshold} />
      </div>
      <QuotaFootnotes
        rule={rule}
        warnThreshold={warnThreshold}
        reset={reset}
        extras={
          rule.limit.kind === 'unlimited' || !rule.label
            ? []
            : [`${describeQuotaWindow(rule.window)}${rule.metric === 'cost' ? '消费' : '请求'}`]
        }
      />
    </div>
  )
}

function IndependentQuotaGroup({
  buckets,
  warnThreshold,
}: {
  buckets: QuotaBucketUsageDTO[]
  warnThreshold: number
}) {
  const first = buckets[0]!
  const title = describeQuotaRuleGroupTitle(buckets)
  const sharedReset = buckets.every((bucket) => quotaResetKey(bucket) === quotaResetKey(first))
  const groupReset = describeQuotaReset(first)
  const exhausted = buckets.filter((bucket) => bucket.blocked).length
  const warning = buckets.filter(
    (bucket) => !bucket.blocked && (bucket.percent ?? 0) >= warnThreshold,
  ).length

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-100">
          {title}
        </span>
        <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-px text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          各自独立
        </span>
        {exhausted > 0 && (
          <span className="shrink-0 rounded-md bg-rose-50 px-1.5 py-px text-[10px] font-medium text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
            {exhausted === buckets.length ? '已耗尽' : `部分耗尽 ${exhausted}`}
          </span>
        )}
        {exhausted === 0 && warning > 0 && (
          <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:bg-amber-400/10 dark:text-amber-300">
            接近上限
          </span>
        )}
      </div>

      <div className="mt-2.5 space-y-3">
        {buckets.map((rule) => (
          <div key={`${rule.ruleId}:${rule.bucketKey ?? ''}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-100">
                {rule.bucketLabel ?? '未命名目标'}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                <UsageFigure rule={rule} />
              </span>
            </div>
            <div className="mt-2">
              <QuotaBar rule={rule} warnThreshold={warnThreshold} />
            </div>
            <QuotaFootnotes
              rule={rule}
              warnThreshold={warnThreshold}
              reset={sharedReset ? null : describeQuotaReset(rule)}
            />
          </div>
        ))}
      </div>

      {first.limit.kind !== 'unlimited' && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-neutral-400 dark:text-neutral-500">
          <span>
            {describeQuotaWindow(first.window)}
            {first.metric === 'cost' ? '消费' : '请求'}
          </span>
          {sharedReset && groupReset && (
            <QuotaResetChip
              reset={groupReset}
              emphasize={exhausted > 0 ? 'exhausted' : warning > 0 ? 'warning' : undefined}
            />
          )}
        </div>
      )}
    </div>
  )
}

function attentionSummary(rules: QuotaBucketUsageDTO[], warnThreshold: number) {
  const limited = rules.filter((rule) => rule.limit.kind === 'amount' && !rule.invalid)
  return {
    exhausted: limited.filter((rule) => rule.blocked).length,
    warning: limited.filter((rule) => !rule.blocked && (rule.percent ?? 0) >= warnThreshold).length,
  }
}

/**
 * 我的额度卡片。仅在开启限额时渲染（关闭时用户完全看不到限额的存在）。
 * 列表顺序与策略 / 专属规则的展示顺序一致；「各自独立」收成一条规则下的子行。
 * 「无限额度」是一个显式状态，不用一个很大的数字模拟。
 */
export function QuotaProgressCard({ quota }: { quota: MyQuotaDTO }) {
  if (!quota.enabled) return null

  const groups = groupQuotaBucketsByRule(quota.rules)
  const attention = attentionSummary(quota.rules, quota.warnThreshold)

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">我的额度</h2>
          {attention.exhausted > 0 && (
            <span className="rounded-md bg-rose-50 px-1.5 py-px text-[10px] font-medium text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
              已耗尽 {attention.exhausted}
            </span>
          )}
          {attention.warning > 0 && (
            <span className="rounded-md bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:bg-amber-400/10 dark:text-amber-300">
              接近上限 {attention.warning}
            </span>
          )}
        </div>
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
          {groups.map((group) =>
            group.buckets.length > 1 ? (
              <IndependentQuotaGroup
                key={group.ruleId}
                buckets={group.buckets}
                warnThreshold={quota.warnThreshold}
              />
            ) : (
              <SingleQuotaRow
                key={group.ruleId}
                rule={group.buckets[0]!}
                warnThreshold={quota.warnThreshold}
              />
            ),
          )}
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
