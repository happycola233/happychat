import { Activity, Coins, MessageSquare, Sigma } from 'lucide-react'
import type { UsageStatsDTO } from '@shared/types/api'
import { formatCompact, formatInt } from '../lib/format'
import { formatUsageMetric } from './usagePresentation'
import { UsageValue } from './UsagePrimitives'

export function UsageSummary({ stats }: { stats: UsageStatsDTO }) {
  const { totals } = stats
  const items = [
    {
      label: '请求次数',
      icon: Activity,
      value: formatCompact(totals.requests),
      exact: formatInt(totals.requests) + ' 次请求',
      hint: totals.activeDays + ' 天有使用记录',
    },
    {
      label: 'Token 用量',
      icon: Sigma,
      value: formatCompact(totals.totalTokens),
      exact: formatInt(totals.totalTokens) + ' Token',
      hint: totals.requests
        ? '平均每次 ' + formatCompact(totals.totalTokens / totals.requests) + ' Token'
        : '输入与输出的总用量',
    },
    {
      label: '预估花费 · USD',
      icon: Coins,
      value: formatUsageMetric(totals.costUsd, 'costUsd'),
      exact: formatUsageMetric(totals.costUsd, 'costUsd', true) + ' USD',
      hint: totals.requests
        ? '平均每次 ' + formatUsageMetric(totals.costUsd / totals.requests, 'costUsd')
        : '按请求时的模型价格估算',
    },
    {
      label: '新建对话',
      icon: MessageSquare,
      value: formatCompact(totals.conversations),
      exact: formatInt(totals.conversations) + ' 个对话',
      hint:
        formatInt(totals.messages) +
        ' 条消息' +
        (totals.imageGenerations ? ' · ' + formatInt(totals.imageGenerations) + ' 次生图' : ''),
    },
  ]
  return (
    <section
      aria-label="用量概览"
      className="grid grid-cols-2 gap-x-6 gap-y-6 border-b border-neutral-100 pb-6 sm:gap-8 lg:grid-cols-4 dark:border-neutral-800"
    >
      {items.map(({ label, icon: Icon, value, exact, hint }) => (
        <div key={label} className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
            {label}
          </div>
          <UsageValue
            exact={exact}
            className="my-2 text-[26px] font-semibold leading-tight tracking-tight text-neutral-900 sm:text-[30px] dark:text-neutral-100"
          >
            {value}
          </UsageValue>
          <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{hint}</p>
        </div>
      ))}
    </section>
  )
}
