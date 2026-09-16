import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Download, X } from 'lucide-react'
import {
  getAnalytics,
  getUserStats,
  listAdminModels,
  listProviders,
  listUsers,
} from '../../api/admin'
import { TrendChart, type SeriesDef } from '../../components/charts'
import { Button } from '../../components/ui/Button'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
import { Select } from '../../components/ui/Select'
import { rangeToFilter } from '../../lib/dateRange'
import { formatCompact, formatInt, formatPercent, formatUsd } from '../../lib/format'
import { AnalyticsUsers } from './AnalyticsUsers'
import {
  DashboardError,
  DashboardLoading,
  DashboardPanel,
  MetricStrip,
  RefreshButton,
} from './DashboardPrimitives'
import {
  dashboardHref,
  EMPTY_ANALYTICS_POINT,
  fillTimeBuckets,
  readDashboardFilters,
  summarizeAnalytics,
} from './dashboardData'
import { UsageRanking } from './UsageRanking'

const TOKEN_SERIES: SeriesDef[] = [
  { key: 'inputTokens', name: '输入', color: '#0284c7' },
  { key: 'outputTokens', name: '输出', color: '#8b5cf6' },
  { key: 'cacheWriteTokens', name: '缓存写入', color: '#f97316' },
  { key: 'cachedTokens', name: '缓存读取', color: '#10b981' },
  { key: 'reasoningTokens', name: '推理', color: '#eab308' },
]
const CHART_MODES = {
  tokens: { label: 'Token', series: TOKEN_SERIES, format: formatCompact },
  requests: {
    label: '请求',
    series: [{ key: 'requests', name: '请求', color: '#0284c7' }],
    format: formatInt,
  },
  cost: {
    label: '成本',
    series: [{ key: 'costUsd', name: '成本 · USD', color: '#10b981' }],
    format: formatUsd,
  },
}
type ChartMode = keyof typeof CHART_MODES

export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const { rangeKey, providerId, modelId, userId, kindSel } = readDashboardFilters(params)
  const [chartMode, setChartMode] = useState<ChartMode>('tokens')
  const updateFilters = (patch: Record<string, string>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )

  const providers = useQuery({ queryKey: ['admin', 'providers'], queryFn: listProviders })
  const models = useQuery({ queryKey: ['admin', 'models'], queryFn: listAdminModels })
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: listUsers })
  // 每次实际请求时重新计算相对窗口，手动刷新不会继续使用挂载时的起点。
  const buildQuery = () => ({
    ...rangeToFilter(rangeKey),
    providerId: providerId || undefined,
    modelId: modelId || undefined,
    userId: userId || undefined,
    kind: kindSel || undefined,
  })
  const analytics = useQuery({
    queryKey: ['admin', 'analytics', rangeKey, providerId, modelId, userId, kindSel],
    queryFn: () => getAnalytics(buildQuery()),
  })
  const userStats = useQuery({
    queryKey: ['admin', 'analytics-user-stats', rangeKey, providerId, modelId, userId, kindSel],
    queryFn: () => getUserStats(buildQuery()),
  })
  const refresh = () => {
    void analytics.refetch()
    void userStats.refetch()
  }
  const data = analytics.data
  const totals = summarizeAnalytics(data?.series ?? [])
  const failed = (data?.models ?? []).reduce((sum, row) => sum + row.failedRequests, 0)
  const now = analytics.dataUpdatedAt || Date.now()
  const series = data
    ? fillTimeBuckets(
        data.series,
        data.bucket,
        rangeToFilter(rangeKey, now).from,
        now,
        EMPTY_ANALYTICS_POINT,
      )
    : []
  const activeFilters = [providerId, modelId, userId, kindSel].filter(Boolean).length
  const eventHref = dashboardHref('request-events', {
    range: rangeKey,
    providerId,
    modelId,
    userId,
    kind: kindSel,
  })
  const tokenParts = [
    {
      label: '未缓存输入',
      value: Math.max(0, totals.inputTokens - totals.cachedTokens - totals.cacheWriteTokens),
      color: '#0284c7',
    },
    { label: '缓存写入', value: totals.cacheWriteTokens, color: '#f97316' },
    { label: '缓存读取', value: totals.cachedTokens, color: '#10b981' },
    {
      label: '非推理输出',
      value: Math.max(0, totals.outputTokens - totals.reasoningTokens),
      color: '#8b5cf6',
    },
    { label: '推理', value: totals.reasoningTokens, color: '#eab308' },
  ]
  const tokenPartsTotal = tokenParts.reduce((sum, part) => sum + part.value, 0)

  const exportTrend = () => {
    // 此导出仅含数字与 ISO 时间，不包含用户名或聊天内容。
    const csv = [
      '时间（UTC）,请求数,总Token,输入Token,输出Token,缓存写入Token,缓存读取Token,推理Token,预估成本（USD）',
      ...series.map((point) =>
        [
          new Date(point.ts).toISOString(),
          point.requests,
          point.totalTokens,
          point.inputTokens,
          point.outputTokens,
          point.cacheWriteTokens,
          point.cachedTokens,
          point.reasoningTokens,
          point.costUsd,
        ].join(','),
      ),
    ].join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `happychat-usage-${rangeKey}-${new Date(now).toISOString().slice(0, 10)}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="分析"
        description="追踪用量变化，了解成本花在哪里。"
        actions={
          <>
            <DateRangePicker value={rangeKey} onChange={(range) => updateFilters({ range })} />
            <RefreshButton busy={analytics.isFetching || userStats.isFetching} onClick={refresh} />
          </>
        }
      />
      <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Select
          label="供应商"
          className="w-full min-w-0"
          value={providerId}
          options={[
            { value: '', label: '全部供应商' },
            ...(providers.data ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={(event) => updateFilters({ providerId: event.target.value, modelId: '' })}
        />
        <Select
          label="模型"
          className="w-full min-w-0"
          value={modelId}
          options={[
            { value: '', label: '全部模型' },
            ...(models.data ?? [])
              .filter((m) => !providerId || m.providerId === providerId)
              .map((m) => ({ value: m.id, label: m.displayName })),
          ]}
          onChange={(event) => updateFilters({ modelId: event.target.value })}
        />
        <Select
          label="用户"
          className="w-full min-w-0"
          value={userId}
          options={[
            { value: '', label: '全部用户' },
            ...(users.data ?? []).map((u) => ({
              value: u.id,
              label: u.displayName ? `${u.displayName} · ${u.username}` : u.username,
            })),
          ]}
          onChange={(event) => updateFilters({ userId: event.target.value })}
        />
        <Select
          label="请求类型"
          className="w-full min-w-0"
          value={kindSel}
          options={[
            { value: '', label: '全部请求' },
            { value: 'chat', label: '仅对话' },
            { value: 'title', label: '仅标题总结' },
          ]}
          onChange={(event) => updateFilters({ kind: event.target.value })}
        />
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            className="justify-self-start"
            onClick={() => setParams({ range: rangeKey }, { replace: true })}
          >
            <X className="h-3.5 w-3.5" />
            清除 {activeFilters} 项筛选
          </Button>
        )}
      </div>
      {analytics.isError && <DashboardError hasData={!!data} onRetry={refresh} />}
      {(providers.isError || models.isError || users.isError) && (
        <div role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          部分筛选选项未能加载。
          <Button
            variant="ghost"
            onClick={() => {
              void providers.refetch()
              void models.refetch()
              void users.refetch()
            }}
          >
            重新加载选项
          </Button>
        </div>
      )}
      {analytics.isLoading ? (
        <DashboardLoading />
      ) : (
        data && (
          <>
            <MetricStrip
              items={[
                {
                  label: '请求总数',
                  value: formatInt(totals.requests),
                  hint: totals.requests
                    ? `非失败率 ${formatPercent(1 - failed / totals.requests)}`
                    : '此时段暂无请求',
                },
                {
                  label: 'Token 用量',
                  value: (
                    <span title={formatInt(totals.totalTokens)}>
                      {formatCompact(totals.totalTokens)}
                    </span>
                  ),
                  hint: totals.inputTokens
                    ? `缓存读取率 ${formatPercent(totals.cachedTokens / totals.inputTokens)}`
                    : '暂无输入 Token',
                },
                {
                  label: '预估成本 · USD',
                  value: formatUsd(totals.costUsd),
                  hint: '按请求时的模型价格估算',
                },
                {
                  label: '平均单次成本',
                  value: totals.requests ? formatUsd(totals.costUsd / totals.requests) : '—',
                  hint: `${data.models.length} 个模型 · ${data.providers.length} 个供应商`,
                },
              ]}
            />
            {!totals.requests ? (
              <EmptyState
                title="此时段没有符合筛选条件的请求"
                action={
                  activeFilters ? (
                    <Button
                      variant="secondary"
                      onClick={() => setParams({ range: rangeKey }, { replace: true })}
                    >
                      清除筛选
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]">
                  <DashboardPanel
                    title="用量趋势"
                    description={data.bucket === 'day' ? '按 UTC 日汇总' : '按小时汇总 · UTC'}
                    actions={
                      <div role="group" aria-label="趋势指标" className="flex gap-1">
                        {(Object.keys(CHART_MODES) as ChartMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={mode === chartMode}
                            className={`min-h-8 rounded-md px-2.5 text-xs transition focus-visible:outline-sky-500 ${mode === chartMode ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'}`}
                            onClick={() => setChartMode(mode)}
                          >
                            {CHART_MODES[mode].label}
                          </button>
                        ))}
                      </div>
                    }
                  >
                    <TrendChart
                      data={series}
                      bucket={data.bucket}
                      series={CHART_MODES[chartMode].series}
                      valueFormat={CHART_MODES[chartMode].format}
                      height={225}
                      timeZone="UTC"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">
                        缓存已包含在输入内，推理已包含在输出内。
                      </p>
                      <Button variant="ghost" onClick={exportTrend}>
                        <Download className="h-3.5 w-3.5" />
                        导出趋势
                      </Button>
                    </div>
                  </DashboardPanel>
                  <DashboardPanel title="Token 构成" description="输入与输出细分">
                    <div
                      className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
                      aria-hidden
                    >
                      {tokenParts.map((part) => (
                        <span
                          key={part.label}
                          style={{
                            backgroundColor: part.color,
                            width: `${tokenPartsTotal ? (part.value / tokenPartsTotal) * 100 : 0}%`,
                          }}
                        />
                      ))}
                    </div>
                    <dl className="space-y-3.5">
                      {tokenParts.map((part) => (
                        <div key={part.label} className="flex items-center gap-2 text-xs">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: part.color }}
                          />
                          <dt className="flex-1">{part.label}</dt>
                          <dd className="font-medium tabular-nums" title={formatInt(part.value)}>
                            {formatCompact(part.value)}
                          </dd>
                          <dd className="w-14 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                            {tokenPartsTotal ? formatPercent(part.value / tokenPartsTotal) : '—'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <Link
                      to={eventHref}
                      className="mt-5 inline-flex min-h-8 items-center gap-1 text-xs text-sky-700 hover:underline dark:text-sky-400"
                    >
                      查看筛选后的请求
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </DashboardPanel>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <UsageRanking
                    title="模型用量排行"
                    rows={data.models}
                    onSelect={(id) => updateFilters({ modelId: id })}
                  />
                  <UsageRanking
                    title="供应商用量排行"
                    rows={data.providers}
                    onSelect={(id) => updateFilters({ providerId: id, modelId: '' })}
                  />
                </div>
              </>
            )}
          </>
        )
      )}
      {userStats.isError ? (
        <DashboardError hasData={!!userStats.data} onRetry={() => void userStats.refetch()} />
      ) : null}
      {userStats.data && (
        <AnalyticsUsers
          key={`${rangeKey}:${providerId}:${modelId}:${userId}:${kindSel}`}
          rows={userStats.data}
        />
      )}
      {userStats.isLoading && !analytics.isLoading && (
        <p role="status" className="py-4 text-center text-xs text-neutral-500">
          正在加载用户用量…
        </p>
      )}
      {data && (
        <p className="text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">
          用量包含已删除账号及模型的历史请求；用户列表仅展示现有账号。未配置价格的用量不产生估算金额。
        </p>
      )}
    </div>
  )
}
