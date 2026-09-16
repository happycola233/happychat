import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { UserStatDTO } from '@shared/types/api'
import { EmptyState } from '../../components/ui/EmptyState'
import { Pagination } from '../../components/ui/Pagination'
import { SearchField } from '../../components/ui/SearchField'
import { Select } from '../../components/ui/Select'
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

type SortKey = 'requests' | 'costUsd' | 'totalTokens'

export function AnalyticsUsers({ rows }: { rows: UserStatDTO[] }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('requests')
  const [page, setPage] = useState(1)
  const needle = search.trim().toLocaleLowerCase()
  const filtered = rows
    .filter((row) =>
      `${row.username} ${row.displayName ?? ''}`.toLocaleLowerCase().includes(needle),
    )
    .sort((a, b) => b[sort] - a[sort] || a.username.localeCompare(b.username))
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 10)))
  const visible = filtered.slice((currentPage - 1) * 10, currentPage * 10)

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">用户用量</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            当前筛选范围内的请求与消费，更多信息可进入详情。
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <SearchField
            placeholder="搜索用户"
            value={search}
            className="flex-1 sm:w-44"
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
          />
          <Select
            aria-label="用户用量排序"
            className="w-36 shrink-0"
            options={[
              { value: 'requests', label: '按请求排序' },
              { value: 'costUsd', label: '按成本排序' },
              { value: 'totalTokens', label: '按 Token 排序' },
            ]}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as SortKey)
              setPage(1)
            }}
          />
        </div>
      </header>
      {!filtered.length ? (
        <EmptyState title={search ? '没有找到匹配的用户' : '此时段暂无用户用量'} />
      ) : (
        <>
          <div className={`hidden md:block ${tableShell}`}>
            <table className={tableEl}>
              <thead className={tableHead}>
                <tr>
                  {['用户', '请求', 'Token', '预估成本', '非失败率', ''].map((label) => (
                    <th key={label} scope="col" className={th}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={tableBody}>
                {visible.map((row) => (
                  <tr key={row.userId} className={tableRowHover}>
                    <td className={td}>
                      <div
                        className="max-w-52 truncate text-xs font-medium"
                        title={row.displayName ?? row.username}
                      >
                        {row.displayName || row.username}
                      </div>
                      <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        {row.displayName ? `${row.username} · ` : ''}
                        {formatRelative(row.lastUsageAt)}使用
                      </div>
                    </td>
                    <td className={`${td} text-xs tabular-nums`}>{formatInt(row.requests)}</td>
                    <td className={`${td} text-xs tabular-nums`} title={formatInt(row.totalTokens)}>
                      {formatCompact(row.totalTokens)}
                    </td>
                    <td className={`${td} text-xs font-medium tabular-nums`}>
                      {formatUsd(row.costUsd)}
                    </td>
                    <td className={`${td} text-xs tabular-nums`}>
                      {formatPercent(row.successRate)}
                    </td>
                    <td className={`${td} text-right`}>
                      <Link
                        aria-label={`查看 ${row.username} 的详情`}
                        to={`/admin/users/${row.userId}`}
                        className="inline-flex min-h-8 items-center gap-1 text-xs text-sky-700 hover:underline dark:text-sky-400"
                      >
                        详情
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-neutral-100 md:hidden dark:divide-neutral-800">
            {visible.map((row) => (
              <Link
                key={row.userId}
                to={`/admin/users/${row.userId}`}
                className="block rounded-lg px-1 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {row.displayName || row.username}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatUsd(row.costUsd)}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400" />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>{formatInt(row.requests)} 次请求</span>
                  <span>{formatCompact(row.totalTokens)} Token</span>
                  <span>非失败 {formatPercent(row.successRate)}</span>
                </div>
              </Link>
            ))}
          </div>
          <Pagination page={currentPage} pageSize={10} total={filtered.length} onPage={setPage} />
        </>
      )}
    </section>
  )
}
