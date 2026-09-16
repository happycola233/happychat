import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { ErrorLogDTO, Paginated } from '@shared/types/api'
import { getErrorEvents } from '../../api/admin'
import { DateRangePicker } from '../../components/ui/DateRangePicker'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
import { type RangeKey } from '../../lib/dateRange'
import { Select } from '../../components/ui/Select'
import { SearchField } from '../../components/ui/SearchField'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { LoadError } from '../../components/ui/LoadError'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { RefreshButton } from './DashboardPrimitives'
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
  { value: 'upstream', label: '上游服务' },
  { value: 'server', label: '应用服务' },
  { value: 'stream', label: '实时连接' },
  { value: 'frontend', label: '浏览器' },
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
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-neutral-600 dark:text-neutral-300">错误详情</span>
        <CopyButton value={JSON.stringify(row, null, 2)} label="复制错误详情" />
      </div>
      <div>
        <div className="break-words whitespace-pre-wrap text-neutral-700 dark:text-neutral-200">
          {row.message}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className="text-neutral-400">错误码</div>
          <div className="break-all text-neutral-700 dark:text-neutral-200">{row.code ?? '—'}</div>
        </div>
        <div>
          <div className="text-neutral-400">HTTP 状态</div>
          <div className="tabular-nums text-neutral-700 dark:text-neutral-200">
            {row.httpStatus ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-neutral-400">运行 ID</div>
          <div className="break-all text-neutral-700 dark:text-neutral-200">{row.runId ?? '—'}</div>
        </div>
      </div>
      {row.detail != null && (
        <details>
          <summary className="min-h-7 cursor-pointer text-neutral-500">原始数据</summary>
          <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-3 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            {JSON.stringify(row.detail, null, 2)}
          </pre>
        </details>
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
  const [live, setLive] = useState(true)
  const debouncedSearch = useDebouncedValue(search, 250)

  const filters = {
    rangeKey,
    scopeSel,
    search: debouncedSearch,
    page,
    pageSize,
  }

  const { data, isLoading, isFetching, isError, refetch } = useQuery<Paginated<ErrorLogDTO>>({
    queryKey: errorEventsQueryKey(filters),
    queryFn: () => getErrorEvents(buildErrorEventsQuery(filters)),
    refetchInterval: live ? 15000 : false,
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
    <div className="space-y-5">
      <PageHeader
        title="错误日志"
        description="定位异常，展开查看完整信息与请求详情。"
        actions={
          <>
            <Button
              variant="ghost"
              aria-pressed={live}
              onClick={() => setLive((current) => !current)}
            >
              {live ? '自动刷新中' : '已暂停刷新'}
            </Button>
            <RefreshButton busy={isFetching} onClick={() => void refetch()} />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker
          value={rangeKey}
          onChange={(k) => {
            setRangeKey(k)
            setPage(1)
          }}
        />
        <Select
          aria-label="错误来源"
          options={SCOPE_OPTIONS}
          value={scopeSel}
          onChange={(e) => {
            setScopeSel(e.target.value)
            setPage(1)
          }}
        />
        <div className="min-w-[200px] flex-1">
          <SearchField
            placeholder="搜索错误信息"
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
          />
        </div>
        {(search || scopeSel) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch('')
              setScopeSel('')
              setPage(1)
            }}
          >
            清除筛选
          </Button>
        )}
        {items.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setExpanded(expanded.size ? new Set() : new Set(items.map((row) => row.id)))
            }
          >
            {expanded.size ? '收起全部详情' : '展开本页详情'}
          </Button>
        )}
      </div>
      {isError && <LoadError hasData={Boolean(data)} onRetry={() => void refetch()} />}

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : isError && !data ? null : items.length === 0 ? (
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
                          <td
                            className={`${td} whitespace-nowrap tabular-nums text-neutral-600 dark:text-neutral-300`}
                          >
                            {formatDateTime(row.createdAt)}
                          </td>
                          <td className={td}>
                            <Badge tone={scopeTone(row.scope)}>
                              {SCOPE_OPTIONS.find((option) => option.value === row.scope)?.label ??
                                row.scope}
                            </Badge>
                          </td>
                          <td
                            className={`${td} whitespace-nowrap text-neutral-700 dark:text-neutral-200`}
                          >
                            {row.errorType ?? row.code ?? '—'}
                          </td>
                          <td
                            className={`${td} tabular-nums text-neutral-700 dark:text-neutral-200`}
                          >
                            {row.httpStatus ?? '—'}
                          </td>
                          <td
                            className={`${td} whitespace-nowrap text-neutral-700 dark:text-neutral-200`}
                          >
                            {row.userId ? (
                              <Link
                                to={`/admin/users/${row.userId}`}
                                onClick={(event) => event.stopPropagation()}
                                className="hover:text-sky-600 dark:hover:text-sky-400"
                              >
                                {row.username ?? '用户'}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={td}>
                            {/* 折叠态按可用宽度截断，完整正文在展开面板里呈现；
                                随断点放宽上限，宽屏尽量多显示。 */}
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-controls={`error-detail-${row.id}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleExpanded(row.id)
                              }}
                              className="flex w-full min-w-0 items-center gap-2 text-left text-neutral-700 dark:text-neutral-200"
                            >
                              <ChevronRight
                                aria-hidden
                                className={`h-3.5 w-3.5 shrink-0 transition ${isOpen ? 'rotate-90' : ''}`}
                              />
                              <span className="block max-w-[220px] truncate lg:max-w-[380px] xl:max-w-[560px]">
                                {row.message}
                              </span>
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-neutral-50 dark:bg-neutral-800/40">
                            <td id={`error-detail-${row.id}`} className={`${td}`} colSpan={6}>
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
                <li
                  key={row.id}
                  className={`${tableShell} bg-neutral-50 p-4 dark:bg-neutral-900/60`}
                >
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => toggleExpanded(row.id)}
                    aria-expanded={isOpen}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={scopeTone(row.scope)}>
                        {SCOPE_OPTIONS.find((option) => option.value === row.scope)?.label ??
                          row.scope}
                      </Badge>
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
