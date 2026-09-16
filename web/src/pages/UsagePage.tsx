import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, RefreshCw } from 'lucide-react'
import { clsx } from 'clsx'
import { getMyUsageStats } from '../api/quota'
import { useMyQuota } from '../hooks/useQuota'
import { Button } from '../components/ui/Button'
import { LoadError } from '../components/ui/LoadError'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { getBrowserTimezone } from '../lib/browserLocale'
import { displayedUsageView, usageWindowTimerDelay } from '../lib/usageWindow'
import { ActivityRhythm } from '../usage/ActivityRhythm'
import { ModelUsageTable } from '../usage/ModelUsageTable'
import { QuotaProgressCard } from '../usage/QuotaProgressCard'
import { UsageHeatmap } from '../usage/UsageHeatmap'
import { UsageTrendCard } from '../usage/UsageTrendCard'
import { UsageSummary } from '../usage/UsageSummary'
import { UsageExportDialog } from '../usage/UsageExportDialog'
import { readUsageView, usageDateRange, USAGE_VIEWS } from '../usage/usagePresentation'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

/** 个人用量与额度各自沿用服务端时间口径；仅统计窗口跟随 URL 选择。 */
export default function UsagePage() {
  useDocumentTitle('使用情况')
  const quotaQuery = useMyQuota()
  const quota = quotaQuery.data
  const [params, setParams] = useSearchParams()
  const view = readUsageView(params.get('view'))
  const [exportOpen, setExportOpen] = useState(false)
  const timezone = getBrowserTimezone()
  const query = useQuery({
    queryKey: ['usage', 'me', view, timezone],
    queryFn: () =>
      getMyUsageStats({ timezone, tzOffsetMinutes: -new Date().getTimezoneOffset(), view }),
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: (previousData) => previousData,
  })
  const stats = query.data
  const { refetch } = query
  const displayedView = displayedUsageView(view, stats?.view)
  const viewLabel = USAGE_VIEWS.find((item) => item.value === displayedView)!.label
  const dateRange = stats
    ? usageDateRange(
        stats.windowStart,
        Math.min(query.dataUpdatedAt || Date.now(), stats.windowEnd - 1),
        timezone,
      )
    : ''

  useEffect(() => {
    if (!stats?.windowEnd) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let canceled = false
    const schedule = () => {
      if (canceled) return
      const delay = usageWindowTimerDelay(stats.windowEnd, Date.now())
      if (delay === null) {
        void refetch()
        return
      }
      timer = setTimeout(schedule, delay)
    }
    schedule()
    return () => {
      canceled = true
      if (timer) clearTimeout(timer)
    }
  }, [refetch, stats?.windowEnd])

  const refresh = () => {
    void refetch()
    void quotaQuery.refetch()
  }
  // 定位滚动容器，让表格的无障碍标题也被包含在内部滚动范围，避免根页面被撑出空白。
  return (
    <main
      id="usage-page"
      className="hc-scrollbar relative h-dvh overflow-y-auto bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <Link
          to="/"
          className="mb-6 inline-flex min-h-9 items-center gap-2 rounded-lg text-sm text-neutral-500 transition hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArrowLeft className="h-4 w-4" />
          返回聊天
        </Link>
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">使用情况</h1>
            <p className="mt-1.5 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
              了解你的用量与花费{quota?.enabled ? '，查看可用额度' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={refresh}
              disabled={query.isFetching || quotaQuery.isFetching}
            >
              <RefreshCw className={clsx('h-3.5 w-3.5', query.isFetching && 'animate-spin')} />
              刷新
            </Button>
            <Button
              variant="secondary"
              disabled={!stats || query.isPlaceholderData}
              onClick={() => setExportOpen(true)}
            >
              <Download className="h-3.5 w-3.5" />
              导出 CSV
            </Button>
          </div>
        </header>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label="统计时段"
            value={view}
            options={USAGE_VIEWS}
            onChange={(next) =>
              setParams((current) => {
                const updated = new URLSearchParams(current)
                updated.set('view', next)
                return updated
              })
            }
          />
          <div
            className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
            aria-live="polite"
          >
            {query.isPlaceholderData ? '正在加载所选时段…' : dateRange}
          </div>
        </div>
        <div className="space-y-5" aria-busy={query.isFetching}>
          {query.isError && <LoadError hasData={!!stats} onRetry={() => void refetch()} />}
          {quotaQuery.isError && (
            <LoadError hasData={!!quota} onRetry={() => void quotaQuery.refetch()} />
          )}
          {query.isLoading ? (
            <div role="status" aria-label="正在加载使用情况" className="motion-safe:animate-pulse">
              <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
                {[0, 1, 2, 3].map((key) => (
                  <div key={key} className="h-24 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
                ))}
              </div>
              <div className="mt-6 h-80 rounded-xl bg-neutral-50 dark:bg-neutral-900" />
            </div>
          ) : (
            stats && (
              <>
                <UsageSummary stats={stats} />
                {quota?.enabled && <QuotaProgressCard quota={quota} />}
                <UsageTrendCard stats={stats} viewLabel={viewLabel} timeZone={timezone} />
                <ModelUsageTable rows={stats.byModel} viewLabel={viewLabel} />
                <UsageHeatmap
                  cells={stats.heatmap}
                  currentStreak={stats.totals.currentStreak}
                  longestStreak={stats.totals.longestStreak}
                />
                <ActivityRhythm
                  key={displayedView}
                  byHour={stats.byHour}
                  byWeekday={stats.byWeekday}
                  busiestHour={stats.busiestHour}
                  busiestWeekday={stats.busiestWeekday}
                  showWeekday={displayedView !== 'day'}
                />
                <footer className="pb-4 pt-1 text-xs leading-6 text-neutral-500 dark:text-neutral-400">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <span>本地时区 · {timezone ?? '浏览器默认'}</span>
                    <span>
                      {query.dataUpdatedAt
                        ? '更新于 ' +
                          new Date(query.dataUpdatedAt).toLocaleTimeString('zh-CN', {
                            hour12: false,
                          }) +
                          ' · 每分钟自动更新'
                        : '正在更新…'}
                    </span>
                  </div>
                  <details className="mt-2">
                    <summary className="w-fit cursor-pointer rounded-sm hover:text-neutral-800 dark:hover:text-neutral-200">
                      统计说明
                    </summary>
                    <div className="mt-2 space-y-1">
                      <p>
                        请求、Token 与花费统计非失败的调用，包含对话及标题总结。
                        {quota?.enabled && '标题总结不占用你的额度。'}
                      </p>
                      <p>
                        花费按请求时的模型价格估算，未配置价格的用量不产生估算金额。
                        {quota?.enabled && '额度按各自规则与周期计算，可能与上方花费不同。'}
                      </p>
                      <p>
                        新建对话与消息只统计所选时段内仍保留的内容；活跃记录与连续活跃天数统计近一年。
                      </p>
                    </div>
                  </details>
                </footer>
              </>
            )
          )}
        </div>
        {exportOpen && stats && (
          <UsageExportDialog
            stats={stats}
            timeZone={timezone}
            dateRange={dateRange}
            onClose={() => setExportOpen(false)}
          />
        )}
      </div>
    </main>
  )
}
