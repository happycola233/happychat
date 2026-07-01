import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ErrorLogDTO, Paginated } from '@shared/types/api'
import { getErrorEvents } from '../../api/admin'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { type RangeKey } from '../../lib/dateRange'
import { Select } from '../../components/ui/Select'
import { TextField } from '../../components/ui/TextField'
import { Pagination } from '../../components/ui/Pagination'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import {
  tableShell,
  tableEl,
  tableHead,
  tableBody,
  tableScroll,
  th,
  td,
  tableRowHover,
} from '../../components/ui/tableStyles'
import { formatDateTime } from '../../lib/format'
import { buildErrorEventsQuery, errorEventsQueryKey } from './eventFilters'

const SCOPE_OPTIONS = [
  { value: '', label: '全部来源' },
  { value: 'upstream', label: 'upstream' },
  { value: 'server', label: 'server' },
  { value: 'stream', label: 'stream' },
  { value: 'frontend', label: 'frontend' },
]

function scopeTone(scope: string): BadgeTone {
  if (scope === 'upstream') return 'warning'
  if (scope === 'server') return 'danger'
  return 'neutral'
}

export default function ErrorEventsPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d')
  const [scopeSel, setScopeSel] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filters = {
    rangeKey,
    scopeSel,
    search,
    page,
    pageSize,
  }

  const { data, isLoading } = useQuery<Paginated<ErrorLogDTO>>({
    queryKey: errorEventsQueryKey(filters),
    queryFn: () => getErrorEvents(buildErrorEventsQuery(filters)),
    refetchInterval: 15000,
  })

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const items = data?.items ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">错误日志</h1>

      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker
          value={rangeKey}
          onChange={(k) => {
            setRangeKey(k)
            setPage(1)
          }}
        />
        <Select
          options={SCOPE_OPTIONS}
          value={scopeSel}
          onChange={(e) => {
            setScopeSel(e.target.value)
            setPage(1)
          }}
        />
        <div className="min-w-[200px] flex-1">
          <TextField
            placeholder="搜索错误信息"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          暂无错误日志 🎉
        </div>
      ) : (
        <div className="space-y-4">
          <Pagination
            page={data?.page ?? page}
            pageSize={data?.pageSize ?? pageSize}
            total={data?.total ?? 0}
            onPage={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n)
              setPage(1)
            }}
          />
          <div className={tableScroll}>
            <div className={`${tableShell} min-w-[720px]`}>
              <table className={tableEl}>
                <thead className={tableHead}>
                  <tr>
                    <th className={th}>时间</th>
                    <th className={th}>来源</th>
                    <th className={th}>类型</th>
                    <th className={th}>HTTP</th>
                    <th className={th}>用户</th>
                    <th className={th}>信息</th>
                  </tr>
                </thead>
                <tbody className={tableBody}>
                  {items.map((row) => {
                    const isOpen = expanded.has(row.id)
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className={`${tableRowHover} cursor-pointer`}
                          onClick={() => toggleExpanded(row.id)}
                        >
                          <td className={`${td} whitespace-nowrap tabular-nums text-neutral-600 dark:text-neutral-300`}>
                            {formatDateTime(row.createdAt)}
                          </td>
                          <td className={td}>
                            <Badge tone={scopeTone(row.scope)}>{row.scope}</Badge>
                          </td>
                          <td className={`${td} whitespace-nowrap text-neutral-700 dark:text-neutral-200`}>
                            {row.errorType ?? row.code ?? '—'}
                          </td>
                          <td className={`${td} tabular-nums text-neutral-700 dark:text-neutral-200`}>
                            {row.httpStatus ?? '—'}
                          </td>
                          <td className={`${td} whitespace-nowrap text-neutral-700 dark:text-neutral-200`}>
                            {row.username ?? '—'}
                          </td>
                          <td className={td}>
                            <span className="block max-w-[420px] truncate text-neutral-700 dark:text-neutral-200">
                              {row.message}
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-neutral-50 dark:bg-neutral-800/40">
                            <td className={`${td} text-xs`} colSpan={6}>
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div>
                                  <div className="text-neutral-400">code</div>
                                  <div className="break-all text-neutral-700 dark:text-neutral-200">
                                    {row.code ?? '—'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-neutral-400">httpStatus</div>
                                  <div className="tabular-nums text-neutral-700 dark:text-neutral-200">
                                    {row.httpStatus ?? '—'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-neutral-400">runId</div>
                                  <div className="break-all text-neutral-700 dark:text-neutral-200">
                                    {row.runId ?? '—'}
                                  </div>
                                </div>
                              </div>
                              {row.detail != null && (
                                <div className="mt-3">
                                  <div className="mb-1 text-neutral-400">detail</div>
                                  <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-3 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                                    {JSON.stringify(row.detail, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            page={data?.page ?? page}
            pageSize={data?.pageSize ?? pageSize}
            total={data?.total ?? 0}
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
