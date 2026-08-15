import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { UsageResult } from '@shared/types/domain'
import { getUsageEvents, listAdminModels, listProviders, listUsers } from '../../api/admin'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
import { type RangeKey } from '../../lib/dateRange'
import { Pagination } from '../../components/ui/Pagination'
import { Select, type SelectOption } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { buildUsageEventsQuery, usageEventsQueryKey } from './eventFilters'
import { RequestKindBadge } from './RequestKindBadge'
import { RequestOutcomeBadge } from './RequestOutcomeBadge'
import { REQUEST_RESULT_LABELS } from './requestOutcome'
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
import { formatCompact, formatDateTime, formatDuration, formatUsd } from '../../lib/format'

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

export default function RequestEventsPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [userId, setUserId] = useState('')
  const [resultSel, setResultSel] = useState<UsageResult | ''>('')
  const [kindSel, setKindSel] = useState('')
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

  const { data, isLoading } = useQuery({
    queryKey: usageEventsQueryKey(filters),
    queryFn: () => getUsageEvents(buildUsageEventsQuery(filters)),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="请求事件"
        description="每条记录代表一次已结算的上游调用。结果描述是否产出可用内容，Token 与成本始终按上游实际返回值记录。"
      />

      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          value={rangeKey}
          onChange={(k) => {
            setRangeKey(k)
            setPage(1)
          }}
        />
        <Select
          label="供应商"
          options={providerOptions}
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value)
            setPage(1)
          }}
        />
        <Select
          label="模型"
          options={modelOptions}
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value)
            setPage(1)
          }}
        />
        <Select
          label="用户"
          options={userOptions}
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value)
            setPage(1)
          }}
        />
        <Select
          label="结果"
          options={RESULT_OPTIONS}
          value={resultSel}
          onChange={(e) => {
            setResultSel(e.target.value as UsageResult | '')
            setPage(1)
          }}
        />
        <Select
          label="请求类型"
          options={KIND_OPTIONS}
          value={kindSel}
          onChange={(e) => {
            setKindSel(e.target.value)
            setPage(1)
          }}
        />
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !data?.items.length ? (
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
          <div className={tableScroll}>
            <div className={`${tableShell} min-w-[1180px]`}>
              <table className={tableEl}>
                <thead className={tableHead}>
                  <tr>
                    <th className={th}>时间</th>
                    <th className={th}>用户</th>
                    <th className={th}>模型</th>
                    <th className={th}>供应商</th>
                    <th className={th}>输入</th>
                    <th className={th}>缓存写入</th>
                    <th className={th}>缓存读取</th>
                    <th className={th}>输出</th>
                    <th className={th}>推理</th>
                    <th className={th}>总计</th>
                    <th className={th}>成本</th>
                    <th className={th}>耗时</th>
                    <th className={th}>结果</th>
                  </tr>
                </thead>
                <tbody className={tableBody}>
                  {data.items.map((row) => (
                    <tr key={row.id} className={tableRowHover}>
                      <td
                        className={`${td} whitespace-nowrap text-neutral-600 dark:text-neutral-300`}
                      >
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td
                        className={`${td} whitespace-nowrap text-neutral-700 dark:text-neutral-200`}
                      >
                        {row.username ?? '—'}
                      </td>
                      <td
                        className={`${td} whitespace-nowrap text-neutral-700 dark:text-neutral-200`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {row.modelLabel ?? '—'}
                          <RequestKindBadge kind={row.kind} />
                        </span>
                      </td>
                      <td
                        className={`${td} whitespace-nowrap text-neutral-700 dark:text-neutral-200`}
                      >
                        {row.providerLabel ?? '—'}
                      </td>
                      <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                        {formatCompact(row.inputTokens)}
                      </td>
                      <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                        {formatCompact(row.cacheWriteTokens)}
                      </td>
                      <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                        {formatCompact(row.cachedTokens)}
                      </td>
                      <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                        {formatCompact(row.outputTokens)}
                      </td>
                      <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                        {formatCompact(row.reasoningTokens)}
                      </td>
                      <td
                        className={`${td} tabular-nums font-medium text-neutral-800 dark:text-neutral-100`}
                      >
                        {formatCompact(row.totalTokens)}
                      </td>
                      <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                        {formatUsd(row.costUsd)}
                      </td>
                      <td
                        className={`${td} whitespace-nowrap tabular-nums text-neutral-600 dark:text-neutral-300`}
                      >
                        {row.durationMs === null ? '—' : formatDuration(row.durationMs)}
                      </td>
                      <td className={td}>
                        <RequestOutcomeBadge
                          kind={row.kind}
                          result={row.result}
                          terminalReason={row.terminalReason}
                        />
                      </td>
                    </tr>
                  ))}
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
