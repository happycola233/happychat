import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ErrorLogDTO, Paginated } from '@shared/types/api'
import { getErrorEvents } from '../../api/admin'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
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

/**
 * 展开后的错误详情（桌面表格与移动卡片共用）。
 * 首要展示完整「信息」正文——折叠态无论表格截断还是卡片按行夹取都读不全，
 * 这里必须换行完整呈现；其后才是 code/httpStatus/runId 与原始 detail。
 */
function ErrorLogDetail({ row }: { row: ErrorLogDTO }) {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <div className="mb-1 text-neutral-400">信息</div>
        <div className="break-words whitespace-pre-wrap text-neutral-700 dark:text-neutral-200">
          {row.message}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className="text-neutral-400">code</div>
          <div className="break-all text-neutral-700 dark:text-neutral-200">{row.code ?? '—'}</div>
        </div>
        <div>
          <div className="text-neutral-400">httpStatus</div>
          <div className="tabular-nums text-neutral-700 dark:text-neutral-200">
            {row.httpStatus ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-neutral-400">runId</div>
          <div className="break-all text-neutral-700 dark:text-neutral-200">{row.runId ?? '—'}</div>
        </div>
      </div>
      {row.detail != null && (
        <div>
          <div className="mb-1 text-neutral-400">detail</div>
          <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-3 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            {JSON.stringify(row.detail, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
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
      <PageHeader title="错误日志" />

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
        <EmptyState title="暂无错误日志 🎉" />
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
          <div className={`${tableScroll} hidden md:block`}>
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
                            {/* 折叠态按可用宽度截断，完整正文在展开面板里呈现；
                                随断点放宽上限，宽屏尽量多显示。 */}
                            <span className="block max-w-[220px] truncate text-neutral-700 lg:max-w-[380px] xl:max-w-[560px] dark:text-neutral-200">
                              {row.message}
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-neutral-50 dark:bg-neutral-800/40">
                            <td className={`${td}`} colSpan={6}>
                              <ErrorLogDetail row={row} />
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

          {/* 移动端：卡片列表，杜绝横向滚动的宽表 */}
          <ul className="space-y-2 md:hidden">
            {items.map((row) => {
              const isOpen = expanded.has(row.id)
              const typeText = row.errorType ?? row.code
              return (
                <li key={row.id} className={`${tableShell} p-3`}>
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => toggleExpanded(row.id)}
                    aria-expanded={isOpen}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={scopeTone(row.scope)}>{row.scope}</Badge>
                      {typeText && (
                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                          {typeText}
                        </span>
                      )}
                      {row.httpStatus != null && (
                        <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          HTTP {row.httpStatus}
                        </span>
                      )}
                    </div>
                    <p
                      className={`mt-2 text-sm break-words text-neutral-700 dark:text-neutral-200 ${
                        isOpen ? '' : 'line-clamp-2'
                      }`}
                    >
                      {row.message}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-neutral-400">
                      <span className="tabular-nums">{formatDateTime(row.createdAt)}</span>
                      {row.username && <span>· {row.username}</span>}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                      <ErrorLogDetail row={row} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

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
