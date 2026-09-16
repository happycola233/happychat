import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { SlidersHorizontal } from 'lucide-react'
import type { UsageResult } from '@shared/types/domain'
import { getUsageEvents, listAdminModels, listProviders, listUsers } from '../../api/admin'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
import { type RangeKey } from '../../lib/dateRange'
import { Pagination } from '../../components/ui/Pagination'
import { Select, type SelectOption } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { Button } from '../../components/ui/Button'
import { LoadError } from '../../components/ui/LoadError'
import { RefreshButton } from './DashboardPrimitives'
import { RequestEventCard } from './RequestEventCard'
import { buildUsageEventsQuery, usageEventsQueryKey } from './eventFilters'
import { RequestKindBadge } from './RequestKindBadge'
import { RequestOutcomeBadge } from './RequestOutcomeBadge'
import { REQUEST_RESULT_LABELS } from './requestOutcome'
import { readDashboardFilters } from './dashboardData'
import {
  tableBody,
  tableEl,
  tableHead,
  tableRowHover,
  tableScroll,
  tableShell,
  td,
  th,
} from '../../components/ui/tableStyles'
import { formatInt, formatUsd } from '../../lib/format'
import {
  formatCacheRate,
  formatGenerationSpeed,
  formatRequestEventTimestamp,
  formatRequestLatency,
} from './requestEventDisplay'

const RESULT_OPTIONS: SelectOption[] = [
  { value: '', label: '全部结果' },
  { value: 'completed', label: REQUEST_RESULT_LABELS.completed },
  { value: 'incomplete', label: REQUEST_RESULT_LABELS.incomplete },
  { value: 'refused', label: REQUEST_RESULT_LABELS.refused },
  { value: 'filtered', label: REQUEST_RESULT_LABELS.filtered },
  { value: 'failed', label: REQUEST_RESULT_LABELS.failed },
  { value: 'canceled', label: REQUEST_RESULT_LABELS.canceled },
  { value: 'interrupted', label: REQUEST_RESULT_LABELS.interrupted },
]

/** 标题总结是后台自动发起的调用：保留请求与成本审计，但不占用户额度，且常需要单独过滤。 */
const KIND_OPTIONS: SelectOption[] = [
  { value: '', label: '全部请求' },
  { value: 'chat', label: '仅对话' },
  { value: 'title', label: '仅标题总结' },
]

const EMPTY_VALUE = '-'
const requestCell = `${td} !py-2`
const primaryValue =
  'whitespace-nowrap text-xs font-semibold leading-4 text-neutral-800 tabular-nums dark:text-neutral-100'
const regularPrimaryValue =
  'whitespace-nowrap text-xs font-normal leading-4 text-neutral-800 tabular-nums dark:text-neutral-100'
const secondaryValue =
  'whitespace-nowrap text-[10px] leading-[14px] text-neutral-400 tabular-nums dark:text-neutral-500'

export default function RequestEventsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { rangeKey, providerId, modelId, userId, resultSel, kindSel } =
    readDashboardFilters(searchParams)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const updateFilter = (key: string, value: string) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        if (key === 'providerId') next.delete('modelId')
        return next
      },
      { replace: true },
    )
  const setRangeKey = (value: RangeKey) => updateFilter('range', value)
  const setProviderId = (value: string) => updateFilter('providerId', value)
  const setModelId = (value: string) => updateFilter('modelId', value)
  const setUserId = (value: string) => updateFilter('userId', value)
  const setResultSel = (value: UsageResult | '') => updateFilter('result', value)
  const setKindSel = (value: string) => updateFilter('kind', value)
  const filterCount = [providerId, modelId, userId, resultSel, kindSel].filter(Boolean).length
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

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
      ...(models ?? [])
        .filter((model) => !providerId || model.providerId === providerId)
        .map((m) => ({ value: m.id, label: m.displayName })),
    ],
    [models, providerId],
  )
  const userOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: '全部用户' },
      ...(users ?? []).map((u) => ({ value: u.id, label: u.username })),
    ],
    [users],
  )

  const filters = {
    rangeKey,
    providerId,
    modelId,
    userId,
    resultSel,
    kindSel,
    page,
    pageSize,
  }

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: usageEventsQueryKey(filters),
    queryFn: () => getUsageEvents(buildUsageEventsQuery(filters)),
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="请求事件"
        description="查看每次已结算上游调用的结果、总耗时、上游首响应、生成速度、Token、缓存与成本。"
        actions={<RefreshButton busy={isFetching} onClick={() => void refetch()} />}
      />

      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          value={rangeKey}
          onChange={(k) => {
            setRangeKey(k)
            setPage(1)
          }}
        />
        <Button
          variant={filterCount ? 'secondary' : 'ghost'}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
          className="md:hidden"
        >
          <SlidersHorizontal className="h-4 w-4" />
          筛选{filterCount ? ` · ${filterCount}` : ''}
        </Button>
        <div
          className={`${filtersOpen ? 'grid' : 'hidden'} w-full grid-cols-2 gap-3 md:flex md:w-auto md:flex-wrap md:items-end`}
        >
          <Select
            label="供应商"
            className="w-full md:w-44"
            options={providerOptions}
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value)
              setPage(1)
            }}
          />
          <Select
            label="模型"
            className="w-full md:w-48"
            options={modelOptions}
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value)
              setPage(1)
            }}
          />
          <Select
            label="用户"
            className="w-full md:w-36"
            options={userOptions}
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value)
              setPage(1)
            }}
          />
          <Select
            label="结果"
            className="w-full md:w-28"
            options={RESULT_OPTIONS}
            value={resultSel}
            onChange={(e) => {
              setResultSel(e.target.value as UsageResult | '')
              setPage(1)
            }}
          />
          <Select
            label="请求类型"
            className="w-full md:w-28"
            options={KIND_OPTIONS}
            value={kindSel}
            onChange={(e) => {
              setKindSel(e.target.value)
              setPage(1)
            }}
          />
        </div>
        {filterCount > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearchParams({ range: rangeKey }, { replace: true })
              setPage(1)
            }}
          >
            清除筛选
          </Button>
        )}
      </div>
      {isError && <LoadError hasData={Boolean(data)} onRetry={() => void refetch()} />}

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : isError && !data ? null : !data?.items.length ? (
        <EmptyState title="暂无请求事件" />
      ) : (
        <div className="space-y-4">
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n)
              setPage(1)
            }}
          />
          <div className="grid gap-3 md:grid-cols-2 xl:hidden">
            {data.items.map((row) => (
              <RequestEventCard key={row.id} row={row} />
            ))}
          </div>
          <div className={`${tableScroll} hidden xl:block`}>
            <div className={`${tableShell} min-w-[1160px]`}>
              <table className={tableEl}>
                <thead className={tableHead}>
                  <tr>
                    <th className={`${th} w-[96px]`}>时间</th>
                    <th className={`${th} w-[100px]`}>用户</th>
                    <th className={`${th} w-[160px]`}>模型</th>
                    <th className={`${th} w-[96px]`}>推理强度</th>
                    <th className={`${th} w-[126px]`}>总耗时</th>
                    <th className={`${th} w-[102px]`}>生成速度</th>
                    <th className={`${th} w-[170px]`}>Tokens</th>
                    <th className={`${th} w-[120px]`}>缓存</th>
                    <th className={`${th} w-[76px]`}>成本</th>
                    <th className={`${th} w-[84px]`}>结果</th>
                  </tr>
                </thead>
                <tbody className={tableBody}>
                  {data.items.map((row) => {
                    const timestamp = formatRequestEventTimestamp(row.createdAt)
                    return (
                      <tr key={row.id} className={tableRowHover}>
                        <td className={requestCell}>
                          <div className={primaryValue}>{timestamp.time}</div>
                          <div className={secondaryValue}>{timestamp.date}</div>
                        </td>
                        <td className={requestCell}>
                          <div
                            className="max-w-[100px] truncate whitespace-nowrap text-xs font-normal leading-4 text-neutral-800 dark:text-neutral-100"
                            title={row.username ?? undefined}
                          >
                            {row.userId ? (
                              <Link
                                to={`/admin/users/${row.userId}`}
                                className="hover:text-sky-600 dark:hover:text-sky-400"
                              >
                                {row.username ?? EMPTY_VALUE}
                              </Link>
                            ) : (
                              (row.username ?? EMPTY_VALUE)
                            )}
                          </div>
                        </td>
                        <td className={requestCell}>
                          <div
                            className="max-w-[180px] truncate whitespace-nowrap text-xs font-semibold leading-4 text-neutral-800 dark:text-neutral-100"
                            title={row.modelLabel ?? undefined}
                          >
                            {row.modelLabel ?? EMPTY_VALUE}
                          </div>
                          <div
                            className={`${secondaryValue} max-w-[180px] truncate`}
                            title={row.modelDisplayName ?? undefined}
                          >
                            {row.modelDisplayName ?? EMPTY_VALUE}
                          </div>
                          <div
                            className={`${secondaryValue} flex max-w-[180px] items-center gap-1`}
                          >
                            <span className="truncate" title={row.providerLabel ?? undefined}>
                              {row.providerLabel ?? EMPTY_VALUE}
                            </span>
                            <RequestKindBadge kind={row.kind} />
                          </div>
                        </td>
                        <td className={requestCell}>
                          <div className={`${regularPrimaryValue} font-mono`}>
                            {row.reasoningEffort ?? EMPTY_VALUE}
                          </div>
                        </td>
                        <td className={requestCell}>
                          <div className={primaryValue}>{formatRequestLatency(row.durationMs)}</div>
                          <div className={secondaryValue}>
                            上游首响应 {formatRequestLatency(row.upstreamResponseLatencyMs)}
                          </div>
                          <div className={secondaryValue}>
                            首字延迟 {formatRequestLatency(row.firstTokenLatencyMs)}
                          </div>
                        </td>
                        <td className={requestCell}>
                          <div className={regularPrimaryValue}>
                            {formatGenerationSpeed(row.generationTokensPerSecond)}
                          </div>
                        </td>
                        <td className={requestCell}>
                          <div className={primaryValue}>{formatInt(row.totalTokens)}</div>
                          <div className={secondaryValue}>输入 {formatInt(row.inputTokens)}</div>
                          <div className={secondaryValue}>
                            输出 {formatInt(row.outputTokens)}（推理{' '}
                            {formatInt(row.reasoningTokens)}）
                          </div>
                        </td>
                        <td className={requestCell}>
                          <div className={primaryValue}>
                            {formatCacheRate(row.cachedTokens, row.inputTokens)}
                          </div>
                          <div className={secondaryValue}>Read {formatInt(row.cachedTokens)}</div>
                          <div className={secondaryValue}>
                            Write {formatInt(row.cacheWriteTokens)}
                          </div>
                        </td>
                        <td className={requestCell}>
                          <div className={primaryValue}>{formatUsd(row.costUsd)}</div>
                        </td>
                        <td className={requestCell}>
                          <RequestOutcomeBadge
                            kind={row.kind}
                            result={row.result}
                            terminalReason={row.terminalReason}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n)
              setPage(1)
            }}
          />
        </div>
      )}
    </div>
  )
}
