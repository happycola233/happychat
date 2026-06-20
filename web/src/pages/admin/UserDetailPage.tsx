import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import type { UsageLogDTO, UserStatDTO } from '@shared/types/api'
import { getUsageEvents, getUserStats } from '../../api/admin'
import { StatCard } from '../../components/ui/StatCard'
import { Badge } from '../../components/ui/Badge'
import { Pagination } from '../../components/ui/Pagination'
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
  formatDateTime,
  formatInt,
  formatPercent,
  formatRelative,
  formatUsd,
} from '../../lib/format'

const PAGE_SIZE = 50

export default function UserDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)

  const statsQuery = useQuery({
    queryKey: ['admin', 'user-stats', id],
    queryFn: () => getUserStats({ userId: id }),
    enabled: !!id,
  })
  const usageQuery = useQuery({
    queryKey: ['admin', 'user-usage', id, page],
    queryFn: () => getUsageEvents({ userId: id, page, pageSize: PAGE_SIZE }),
    enabled: !!id,
  })

  const stat: UserStatDTO | undefined = statsQuery.data?.[0]

  if (!id) {
    return (
      <div className="space-y-6">
        <BackLink />
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          未指定用户。
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <div>
        {statsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-neutral-400">
            <Spinner className="h-5 w-5" />
            <span className="text-sm">加载中…</span>
          </div>
        ) : stat ? (
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {stat.username}
            {stat.displayName && (
              <span className="ml-2 text-sm font-normal text-neutral-400">{stat.displayName}</span>
            )}
          </h1>
        ) : (
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">用户详情</h1>
        )}
      </div>

      {stat && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="请求" value={formatInt(stat.requests)} />
            <StatCard label="Token" value={formatCompact(stat.totalTokens)} />
            <StatCard label="成本" value={formatUsd(stat.costUsd)} />
            <StatCard label="错误" value={formatInt(stat.errors)} />
            <StatCard label="成功率" value={formatPercent(stat.successRate)} />
            <StatCard label="会话" value={formatInt(stat.conversations)} />
            <StatCard label="消息" value={formatInt(stat.messages)} />
            <StatCard label="最近活跃" value={formatRelative(stat.lastActive)} />
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">常用模型</div>
            <div className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">
              {stat.topModels.length
                ? stat.topModels.map((m) => `${m.model} (${m.calls})`).join('、')
                : '—'}
            </div>
          </div>
        </>
      )}

      {!statsQuery.isLoading && !stat && (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          未找到该用户的统计数据。
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">使用记录</h2>
        {usageQuery.isLoading ? (
          <div className="py-16 text-center">
            <Spinner className="h-6 w-6 text-neutral-400" />
          </div>
        ) : !usageQuery.data?.items.length ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
            暂无使用记录。
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className={tableShell}>
                <table className={tableEl}>
                  <thead className={tableHead}>
                    <tr>
                      <th className={th}>时间</th>
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
                    {usageQuery.data.items.map((e: UsageLogDTO) => (
                      <tr key={e.id} className={tableRowHover}>
                        <td className={`${td} whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400`}>
                          {formatDateTime(e.createdAt)}
                        </td>
                        <td className={`${td} text-neutral-800 dark:text-neutral-200`}>
                          {e.modelLabel ?? '—'}
                        </td>
                        <td className={`${td} text-neutral-500 dark:text-neutral-400`}>
                          {e.providerLabel ?? '—'}
                        </td>
                        <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                          {formatInt(e.inputTokens)}
                        </td>
                        <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                          {formatInt(e.cachedTokens)}
                        </td>
                        <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                          {formatInt(e.outputTokens)}
                        </td>
                        <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                          {formatInt(e.reasoningTokens)}
                        </td>
                        <td className={`${td} tabular-nums text-neutral-800 dark:text-neutral-200`}>
                          {formatInt(e.totalTokens)}
                        </td>
                        <td className={`${td} tabular-nums text-neutral-600 dark:text-neutral-300`}>
                          {formatUsd(e.costUsd)}
                        </td>
                        <td className={td}>
                          {e.success ? (
                            <Badge tone="success">成功</Badge>
                          ) : (
                            <Badge tone="danger">{e.errorType ?? '失败'}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <Pagination
              page={usageQuery.data.page}
              pageSize={usageQuery.data.pageSize}
              total={usageQuery.data.total}
              onPage={setPage}
            />
          </>
        )}
      </section>
    </div>
  )

  function BackLink() {
    return (
      <Link
        to="/admin/auth-center"
        onClick={(ev) => {
          if (window.history.length > 1) {
            ev.preventDefault()
            navigate(-1)
          }
        }}
        className="inline-flex items-center gap-1 text-sm text-neutral-500 transition hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ArrowLeft className="h-4 w-4" />
        返回账号中心
      </Link>
    )
  }
}
