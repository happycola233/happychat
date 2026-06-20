import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { StatsQuery } from '../../api/admin'
import { getAnalytics, getUserStats, listAdminModels, listProviders, listUsers } from '../../api/admin'
import { TrendChart, type SeriesDef } from '../../components/charts'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { rangeToFilter, type RangeKey } from '../../lib/dateRange'
import { Select, type SelectOption } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import {
  tableBody,
  tableEl,
  tableHead,
  tableRowHover,
  tableShell,
  td,
  th,
} from '../../components/ui/tableStyles'
import {
  formatCompact,
  formatInt,
  formatPercent,
  formatRelative,
  formatUsd,
} from '../../lib/format'

const TOKEN_SERIES: SeriesDef[] = [
  { key: 'inputTokens', name: '输入', color: '#0ea5e9' },
  { key: 'outputTokens', name: '输出', color: '#6366f1' },
  { key: 'cachedTokens', name: '缓存', color: '#10b981' },
  { key: 'reasoningTokens', name: '推理', color: '#f59e0b' },
]
const REQUEST_SERIES: SeriesDef[] = [{ key: 'requests', name: '请求', color: '#6366f1' }]
const COST_SERIES: SeriesDef[] = [{ key: 'costUsd', name: '成本', color: '#10b981' }]

const cardClass =
  'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'

export default function AnalyticsPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [userId, setUserId] = useState('')

  const clientBucket: 'hour' | 'day' = rangeKey === '24h' ? 'hour' : 'day'

  const { data: providers } = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: listProviders,
  })
  const { data: models } = useQuery({
    queryKey: ['admin', 'models'],
    queryFn: listAdminModels,
  })
  const { data: users } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: listUsers,
  })

  const query = useMemo<StatsQuery>(
    () => ({
      ...rangeToFilter(rangeKey),
      providerId: providerId || undefined,
      modelId: modelId || undefined,
      userId: userId || undefined,
    }),
    [rangeKey, providerId, modelId, userId],
  )

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['admin', 'analytics', rangeKey, providerId, modelId, userId],
    queryFn: () => getAnalytics(query),
  })
  const { data: userStats, isLoading: userStatsLoading } = useQuery({
    queryKey: ['admin', 'analytics-user-stats', rangeKey, providerId, modelId, userId],
    queryFn: () => getUserStats(query),
  })

  const providerOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: '全部供应商' },
      ...(providers ?? []).map((p) => ({ value: p.id, label: p.name })),
    ],
    [providers],
  )
  const modelOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: '全部模型' },
      ...(models ?? []).map((m) => ({ value: m.id, label: m.displayName })),
    ],
    [models],
  )
  const userOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: '全部用户' },
      ...(users ?? []).map((u) => ({ value: u.id, label: u.username })),
    ],
    [users],
  )

  // AnalyticsSeriesPoint 的全部字段均为 number，结构上即图表所需的数据点；
  // 接口无索引签名，故显式转为 TrendChart 的 data 类型。
  const series = (analytics?.series ?? []) as unknown as Record<string, number>[]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">分析</h1>
        <DateRangePicker value={rangeKey} onChange={setRangeKey} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="供应商"
          value={providerId}
          options={providerOptions}
          onChange={(e) => setProviderId(e.target.value)}
        />
        <Select
          label="模型"
          value={modelId}
          options={modelOptions}
          onChange={(e) => setModelId(e.target.value)}
        />
        <Select
          label="用户"
          value={userId}
          options={userOptions}
          onChange={(e) => setUserId(e.target.value)}
        />
      </div>

      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-200">
          Token 趋势
        </h2>
        {analyticsLoading ? (
          <div className="flex h-[260px] items-center justify-center">
            <Spinner className="h-6 w-6 text-neutral-400" />
          </div>
        ) : (
          <TrendChart
            data={series}
            bucket={clientBucket}
            valueFormat={formatCompact}
            series={TOKEN_SERIES}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-200">请求数</h2>
          {analyticsLoading ? (
            <div className="flex h-[260px] items-center justify-center">
              <Spinner className="h-6 w-6 text-neutral-400" />
            </div>
          ) : (
            <TrendChart
              data={series}
              bucket={clientBucket}
              valueFormat={formatInt}
              series={REQUEST_SERIES}
            />
          )}
        </div>
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            成本(USD)
          </h2>
          {analyticsLoading ? (
            <div className="flex h-[260px] items-center justify-center">
              <Spinner className="h-6 w-6 text-neutral-400" />
            </div>
          ) : (
            <TrendChart
              data={series}
              bucket={clientBucket}
              valueFormat={formatUsd}
              series={COST_SERIES}
            />
          )}
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-200">分用户统计</h2>
        {userStatsLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="h-6 w-6 text-neutral-400" />
          </div>
        ) : !userStats?.length ? (
          <div className="py-12 text-center text-sm text-neutral-500 dark:text-neutral-400">
            暂无数据
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className={tableShell}>
              <table className={tableEl}>
                <thead className={tableHead}>
                  <tr>
                    <th className={th}>用户</th>
                    <th className={th}>请求</th>
                    <th className={th}>会话</th>
                    <th className={th}>消息</th>
                    <th className={th}>Token</th>
                    <th className={th}>推理</th>
                    <th className={th}>图片</th>
                    <th className={th}>文件</th>
                    <th className={th}>成本</th>
                    <th className={th}>错误</th>
                    <th className={th}>成功率</th>
                    <th className={th}>最近活跃</th>
                    <th className={th}>常用模型</th>
                    <th className={th}>操作</th>
                  </tr>
                </thead>
                <tbody className={tableBody}>
                  {userStats.map((u) => (
                    <tr key={u.userId} className={tableRowHover}>
                      <td className={td}>
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {u.username}
                        </div>
                        {u.displayName && (
                          <div className="text-xs text-neutral-400">{u.displayName}</div>
                        )}
                      </td>
                      <td className={`${td} tabular-nums`}>{formatInt(u.requests)}</td>
                      <td className={`${td} tabular-nums`}>{formatInt(u.conversations)}</td>
                      <td className={`${td} tabular-nums`}>{formatInt(u.messages)}</td>
                      <td className={`${td} tabular-nums`}>{formatCompact(u.totalTokens)}</td>
                      <td className={`${td} tabular-nums`}>{formatCompact(u.reasoningTokens)}</td>
                      <td className={`${td} tabular-nums`}>{formatInt(u.imageGenerations)}</td>
                      <td className={`${td} tabular-nums`}>{formatInt(u.fileUploads)}</td>
                      <td className={`${td} tabular-nums`}>{formatUsd(u.costUsd)}</td>
                      <td className={`${td} tabular-nums`}>{formatInt(u.errors)}</td>
                      <td className={`${td} tabular-nums`}>{formatPercent(u.successRate)}</td>
                      <td className={`${td} whitespace-nowrap text-neutral-500 dark:text-neutral-400`}>
                        {formatRelative(u.lastActive)}
                      </td>
                      <td className={`${td} text-neutral-500 dark:text-neutral-400`}>
                        {u.topModels.map((m) => m.model).join('、') || '—'}
                      </td>
                      <td className={td}>
                        <Link
                          to={'/admin/users/' + u.userId}
                          className="text-sky-600 hover:underline dark:text-sky-400"
                        >
                          详情
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
