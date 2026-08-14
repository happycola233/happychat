import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowLeft, Flame, MessageSquare, Sigma, Zap } from 'lucide-react'
import type { UsageStatsDTO } from '@shared/types/api'
import { formatQuotaCostUsd } from '@shared/util/quota'
import { getMyUsageStats } from '../api/quota'
import { useMyQuota } from '../hooks/useQuota'
import { Spinner } from '../components/ui/Spinner'
import { formatCompact, formatInt, formatRelative } from '../lib/format'
import { ActivityRhythm } from '../usage/ActivityRhythm'
import { ModelUsageTable } from '../usage/ModelUsageTable'
import { QuotaProgressCard } from '../usage/QuotaProgressCard'
import { UsageHeatmap } from '../usage/UsageHeatmap'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

/** 服务端按用户本地日分格热力图，因此必须把浏览器时区偏移带上（东八区 = +480）。 */
const timezoneOffsetMinutes = () => -new Date().getTimezoneOffset()

/** 概览指标块：一个大数字 + 一句补充，比一堆小图更容易读。 */
function StatTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string
  hint?: string
  icon: typeof Zap
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">{label}</span>
        <Icon aria-hidden className="h-4 w-4 text-neutral-300 dark:text-neutral-600" />
      </div>
      <div className="mt-1.5 text-[22px] font-semibold leading-tight text-neutral-900 dark:text-neutral-100">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</div>
      )}
    </div>
  )
}

function UsageSummary({ stats }: { stats: UsageStatsDTO }) {
  const { totals, topModel } = stats
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="请求次数"
        value={formatInt(totals.requests)}
        hint={topModel ? `最常用：${topModel.modelLabel}` : '还没有请求记录'}
        icon={Zap}
      />
      <StatTile
        label="消耗 Token"
        value={formatCompact(totals.totalTokens)}
        hint={`累计花费 ${formatQuotaCostUsd(totals.costUsd)}`}
        icon={Sigma}
      />
      <StatTile
        label="对话"
        value={formatInt(totals.conversations)}
        hint={`${formatInt(totals.messages)} 条消息${
          totals.imageGenerations > 0 ? ` · ${totals.imageGenerations} 次生图` : ''
        }`}
        icon={MessageSquare}
      />
      <StatTile
        label="连续活跃"
        value={`${totals.currentStreak} 天`}
        hint={`最长 ${totals.longestStreak} 天 · 活跃 ${totals.activeDays} 天`}
        icon={Flame}
      />
    </div>
  )
}

/**
 * 个人使用情况面板（独立页面，懒加载）。
 *
 * 结构：额度进度 → 概览指标 → 活跃热力图 → 模型构成 + 活跃节律。
 * 关闭全局限额时额度区整块隐藏，其余统计照常展示。
 */
export default function UsagePage() {
  useDocumentTitle('使用情况')
  const { data: quota } = useMyQuota()
  const {
    data: stats,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['usage', 'me'],
    queryFn: () => getMyUsageStats({ tzOffsetMinutes: timezoneOffsetMinutes() }),
    staleTime: 60_000,
  })

  return (
    <div className="hc-scrollbar h-dvh overflow-y-auto bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/"
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-200"
        >
          <ArrowLeft className="h-4 w-4" /> 返回聊天
        </Link>

        <header className="mb-6">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">使用情况</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            你的对话、Token 与花费统计
            {stats?.firstUsedAt ? ` · 首次使用于 ${formatRelative(stats.firstUsedAt)}` : ''}
          </p>
        </header>

        {isLoading ? (
          <div className="py-24 text-center">
            <Spinner className="h-6 w-6 text-neutral-400" />
          </div>
        ) : isError || !stats ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
            统计数据加载失败，请稍后重试。
          </div>
        ) : (
          <div className="space-y-4">
            {quota?.enabled && <QuotaProgressCard quota={quota} />}
            <UsageSummary stats={stats} />
            <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                活跃热力图
              </h2>
              <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
                每格是一天（按你的本地时间），颜色越深表示当天用得越多。
              </p>
              <UsageHeatmap cells={stats.heatmap} />
            </div>
            <ModelUsageTable rows={stats.byModel} />
            <ActivityRhythm
              byHour={stats.byHour}
              byWeekday={stats.byWeekday}
              busiestHour={stats.busiestHour}
              busiestWeekday={stats.busiestWeekday}
            />
          </div>
        )}
      </div>
    </div>
  )
}
