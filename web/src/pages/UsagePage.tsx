import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { ArrowLeft, Flame, MessageSquare, Sigma, Zap } from 'lucide-react'
import type { UsageStatsDTO } from '@shared/types/api'
import type { UsageStatsView } from '@shared/types/domain'
import { formatQuotaCostUsd } from '@shared/util/quota'
import { getMyUsageStats } from '../api/quota'
import { useMyQuota } from '../hooks/useQuota'
import { Spinner } from '../components/ui/Spinner'
import { formatCompact, formatInt, formatRelative } from '../lib/format'
import { ActivityRhythm } from '../usage/ActivityRhythm'
import { ModelUsageTable } from '../usage/ModelUsageTable'
import { QuotaProgressCard } from '../usage/QuotaProgressCard'
import { UsageHeatmap } from '../usage/UsageHeatmap'
import { UsageTrendCard } from '../usage/UsageTrendCard'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

/** 服务端按用户本地日分格热力图，因此必须把浏览器时区偏移带上（东八区 = +480）。 */
const timezoneOffsetMinutes = () => -new Date().getTimezoneOffset()

/** 窗口视图与中文名；窗口边界按浏览器本地时区的自然周期计算。 */
const VIEWS: { value: UsageStatsView; label: string }[] = [
  { value: 'day', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'year', label: '本年' },
]

const viewLabelOf = (view: UsageStatsView) =>
  VIEWS.find((item) => item.value === view)?.label ?? '本月'

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

function UsageSummary({ stats, viewLabel }: { stats: UsageStatsDTO; viewLabel: string }) {
  const { totals, topModel } = stats
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label={`${viewLabel}请求次数`}
        value={formatInt(totals.requests)}
        hint={topModel ? `最常用：${topModel.modelLabel}` : `${viewLabel}还没有请求记录`}
        icon={Zap}
      />
      <StatTile
        label={`${viewLabel}消耗 Token`}
        value={formatCompact(totals.totalTokens)}
        hint={`花费 ${formatQuotaCostUsd(totals.costUsd)}`}
        icon={Sigma}
      />
      <StatTile
        label={`${viewLabel}新建对话`}
        value={formatInt(totals.conversations)}
        hint={`${formatInt(totals.messages)} 条消息${
          totals.imageGenerations > 0 ? ` · ${totals.imageGenerations} 次生图` : ''
        }`}
        icon={MessageSquare}
      />
      {/* 连续活跃是滚动概念（按近一年计算），刻意不随窗口变化 */}
      <StatTile
        label="连续活跃"
        value={`${totals.currentStreak} 天`}
        hint={`最长 ${totals.longestStreak} 天 · ${viewLabel}活跃 ${totals.activeDays} 天`}
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
  const [view, setView] = useState<UsageStatsView>('month')
  const viewLabel = viewLabelOf(view)
  const {
    data: stats,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['usage', 'me', view],
    queryFn: () => getMyUsageStats({ tzOffsetMinutes: timezoneOffsetMinutes(), view }),
    staleTime: 60_000,
    // 切换窗口时先留住上一份数据，避免整页闪回 loading。
    placeholderData: (previousData) => previousData,
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

        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
              使用情况
            </h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              你的对话、Token 与花费统计
              {stats?.firstUsedAt ? ` · 首次使用于 ${formatRelative(stats.firstUsedAt)}` : ''}
            </p>
          </div>
          {/* 窗口切换：自然周期（今日 / 本周 / 本月 / 本年），边界按你的本地时区 */}
          <div className="flex items-center gap-0.5 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
            {VIEWS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={view === item.value}
                onClick={() => setView(item.value)}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                  view === item.value
                    ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                    : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
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
            <UsageSummary stats={stats} viewLabel={viewLabel} />
            <UsageTrendCard stats={stats} viewLabel={viewLabel} />
            <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                活跃热力图 · 近一年
              </h2>
              <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
                每格是一天（按你的本地时间），颜色越深表示当天用得越多；这张图不受上方窗口影响。
              </p>
              <UsageHeatmap cells={stats.heatmap} />
            </div>
            <ModelUsageTable rows={stats.byModel} viewLabel={viewLabel} />
            <ActivityRhythm
              byHour={stats.byHour}
              byWeekday={stats.byWeekday}
              busiestHour={stats.busiestHour}
              busiestWeekday={stats.busiestWeekday}
              showWeekday={view !== 'day'}
            />
          </div>
        )}
      </div>
    </div>
  )
}
