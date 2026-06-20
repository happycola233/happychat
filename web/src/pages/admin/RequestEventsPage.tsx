import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getUsageEvents,
  listAdminModels,
  listProviders,
  listUsers,
  type StatsQuery,
} from '../../api/admin'
import { Badge } from '../../components/ui/Badge'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { rangeToFilter, type RangeKey } from '../../lib/dateRange'
import { Pagination } from '../../components/ui/Pagination'
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
import { formatCompact, formatDateTime, formatUsd } from '../../lib/format'

const PAGE_SIZE = 50

const STATUS_OPTIONS: SelectOption[] = [
  { value: '', label: '全部状态' },
  { value: 'true', label: '成功' },
  { value: 'false', label: '失败' },
]

export default function RequestEventsPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [userId, setUserId] = useState('')
  const [successSel, setSuccessSel] = useState('')
  const [page, setPage] = useState(1)

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

  const query: StatsQuery = {
    ...rangeToFilter(rangeKey),
    providerId: providerId || undefined,
    modelId: modelId || undefined,
    userId: userId || undefined,
    success: successSel === '' ? undefined : successSel === 'true',
    page,
    pageSize: PAGE_SIZE,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'usage-events', query],
    queryFn: () => getUsageEvents(query),
  })

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">请求事件</h1>

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
          label="状态"
          options={STATUS_OPTIONS}
          value={successSel}
          onChange={(e) => {
            setSuccessSel(e.target.value)
            setPage(1)
          }}
        />
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !data?.items.length ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          暂无请求事件
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <div className={tableShell}>
              <table className={tableEl}>
                <thead className={tableHead}>
                  <tr>
                    <th className={th}>时间</th>
                    <th className={th}>用户</th>
                    <th className={th}>模型</th>
                    <th className={th}>供应商</th>
                    <th className={th}>输入</th>
                    <th className={th}>缓存</th>
                    <th className={th}>输出</th>
                    <th className={th}>推理</th>
                    <th className={th}>总计</th>
                    <th className={th}>成本</th>
                    <th className={th}>状态</th>
                  </tr>
                </thead>
                <tbody className={tableBody}>
                  {data.items.map((row) => (
                    <tr key={row.id} className={tableRowHover}>
                      <td className={`${td} whitespace-nowrap text-neutral-600 dark:text-neutral-300`}>
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className={`${td} text-neutral-700 dark:text-neutral-200`}>
                        {row.username ?? '—'}
                      </td>
                      <td className={`${td} text-neutral-700 dark:text-neutral-200`}>
                        {row.modelLabel ?? '—'}
                      </td>
                      <td className={`${td} text-neutral-700 dark:text-neutral-200`}>
                        {row.providerLabel ?? '—'}
                      </td>
                      <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                        {formatCompact(row.inputTokens)}
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
                      <td className={`${td} tabular-nums font-medium text-neutral-800 dark:text-neutral-100`}>
                        {formatCompact(row.totalTokens)}
                      </td>
                      <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                        {formatUsd(row.costUsd)}
                      </td>
                      <td className={td}>
                        <Badge tone={row.success ? 'success' : 'danger'}>
                          {row.success ? '成功' : '失败'}
                        </Badge>
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
          />
        </div>
      )}
    </div>
  )
}
