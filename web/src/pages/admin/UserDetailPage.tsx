import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Gauge, Infinity as InfinityIcon, PauseCircle } from 'lucide-react'
import { clsx } from 'clsx'
import type { UsageLogDTO, UserStatDTO } from '@shared/types/api'
import { formatQuotaAmount, formatQuotaCostUsd } from '@shared/util/quota'
import { describeQuotaWindow } from '@shared/util/quotaWindow'
import { getUsageEvents, getUserQuotaDetail, getUserStats } from '../../api/admin'
import { StatCard } from '../../components/ui/StatCard'
import { Badge } from '../../components/ui/Badge'
import { Pagination } from '../../components/ui/Pagination'
import { cardSurface } from '../../components/ui/Card'
import { Spinner } from '../../components/ui/Spinner'
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
import {
  formatCompact,
  formatDateTime,
  formatInt,
  formatPercent,
  formatRelative,
  formatUsd,
} from '../../lib/format'

/**
 * 限额状态卡：生效规则（含覆写来源）与按模型的消费构成。
 * 具体的编辑动作留在「用户限额」页的配置弹窗里，这里只做只读明细，避免两处实现同一套表单。
 */
function UserQuotaSection({ userId }: { userId: string }) {
  const { data: detail } = useQuery({
    queryKey: ['admin', 'quota', 'user', userId],
    queryFn: () => getUserQuotaDetail(userId),
  })
  if (!detail) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-neutral-400" />
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">限额状态</h2>
        <Link
          to="/admin/quotas"
          className="ml-auto text-xs text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
        >
          去配置
        </Link>
      </div>

      <div className={`${cardSurface} p-5`}>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span>
            策略：{detail.policyName ?? '无'}
            {detail.usingDefaultPolicy && '（跟随默认）'}
          </span>
          {detail.enforcementPaused && (
            <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-px font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
              <PauseCircle className="h-3 w-3" /> 限额已暂停（用量仍在累计）
            </span>
          )}
          {detail.note && <span className="text-neutral-400">备注：{detail.note}</span>}
        </div>

        {detail.rules.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
            <InfinityIcon className="h-4 w-4 text-neutral-400" /> 无限额度
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {detail.rules.map((rule) => (
              <div key={`${rule.ruleId}:${rule.bucketKey ?? ''}`} className="py-2.5 first:pt-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200">
                    {rule.bucketLabel ? `${rule.bucketLabel} · ` : ''}
                    {describeQuotaWindow(rule.window)}
                    {rule.metric === 'cost' ? '消费' : '请求'}
                    {rule.source !== 'policy' && (
                      <span className="ml-1.5 text-[10px] text-sky-600 dark:text-sky-400">
                        {rule.source === 'override' ? '已覆写' : '专属'}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                    {formatQuotaAmount(rule.metric, rule.used)} /{' '}
                    {rule.effectiveLimit === null
                      ? '∞'
                      : formatQuotaAmount(rule.metric, rule.effectiveLimit)}
                  </span>
                </div>
                {rule.effectiveLimit !== null && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className={clsx(
                        'h-full rounded-full',
                        rule.blocked
                          ? 'bg-rose-500 dark:bg-rose-400'
                          : 'bg-sky-500 dark:bg-sky-400',
                      )}
                      style={{
                        width: `${Math.min(100, Math.max(2, Math.round((rule.percent ?? 0) * 100)))}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${cardSurface} p-5`}>
        <div className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          按模型的消费构成（近 30 天）
        </div>
        {detail.byModel.length === 0 ? (
          <div className="text-sm text-neutral-400">暂无用量</div>
        ) : (
          <div className="space-y-2">
            {detail.byModel.map((row) => {
              const max = Math.max(...detail.byModel.map((item) => item.costUsd), 0.000001)
              return (
                <div key={`${row.modelId ?? ''}:${row.modelLabel}`}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-200">
                      {row.modelLabel}
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                      {formatQuotaCostUsd(row.costUsd)} · {formatInt(row.requests)} 次 ·{' '}
                      {formatCompact(row.totalTokens)} tokens
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-sky-500/70 dark:bg-sky-400/70"
                      style={{ width: `${Math.max(2, (row.costUsd / max) * 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

export default function UserDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const statsQuery = useQuery({
    queryKey: ['admin', 'user-stats', id],
    queryFn: () => getUserStats({ userId: id }),
    enabled: !!id,
  })
  const usageQuery = useQuery({
    queryKey: ['admin', 'user-usage', id, page, pageSize],
    queryFn: () => getUsageEvents({ userId: id, page, pageSize }),
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
            <StatCard label="最近使用" value={formatRelative(stat.lastUsageAt)} />
          </div>

          <div className={`${cardSurface} p-5`}>
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

      <UserQuotaSection userId={id} />

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
            <Pagination
              page={usageQuery.data.page}
              pageSize={usageQuery.data.pageSize}
              total={usageQuery.data.total}
              onPage={setPage}
              onPageSizeChange={(n) => {
                setPageSize(n)
                setPage(1)
              }}
            />
            <div className={tableScroll}>
              <div className={`${tableShell} min-w-[980px]`}>
                <table className={tableEl}>
                  <thead className={tableHead}>
                    <tr>
                      <th className={th}>时间</th>
                      <th className={th}>模型</th>
                      <th className={th}>供应商</th>
                      <th className={th}>输入</th>
                      <th className={th}>缓存写入</th>
                      <th className={th}>缓存读取</th>
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
                        <td
                          className={`${td} whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400`}
                        >
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
                          {formatInt(e.cacheWriteTokens)}
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
              onPageSizeChange={(n) => {
                setPageSize(n)
                setPage(1)
              }}
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
