import { ChevronDown, Clock3, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ActiveRequestDTO, ActiveRequestsDTO } from '@shared/types/api'
import { Badge } from '../../components/ui/Badge'
import { CopyButton } from '../../components/ui/CopyButton'
import { Pagination } from '../../components/ui/Pagination'
import { formatDateTime } from '../../lib/format'
import { formatRequestLatency } from './requestEventDisplay'
import { RetryAuditDetails } from './RetryAuditDetails'
import { retryFailureDurationLabel } from './retryAudit'

function activeRequestStatus(row: ActiveRequestDTO): string {
  if (!row.progress) return '等待开始'
  switch (row.progress.phase) {
    case 'connecting':
      return row.progress.attempt > 1 ? '重试连接中' : '等待上游响应'
    case 'waiting_output':
      return '等待输出'
    case 'streaming':
      return '生成中'
    case 'retry_wait':
      return '等待重试'
  }
}

/** 桌面用紧凑行扫读，窄屏重排；发起时间、复制操作和完整重试经过按需展开。 */
export function ActiveRequestsPanel({
  data,
  onPage,
}: {
  data: ActiveRequestsDTO
  onPage: (page: number) => void
}) {
  return (
    <section aria-label="进行中的请求" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          进行中的请求
        </h2>
        <Badge tone="info">{data.total}</Badge>
      </div>
      <div className="divide-y divide-neutral-100 border-y border-neutral-200 dark:divide-neutral-800/60 dark:border-neutral-800">
        {data.items.map((row) => {
          const progress = row.progress
          const waiting = progress?.phase === 'retry_wait'
          const latestFailure = row.retrySummary?.failures.at(-1)
          const retrySeconds =
            progress?.nextRetryAt != null
              ? Math.max(0, Math.ceil((progress.nextRetryAt - data.observedAt) / 1000))
              : null
          return (
            <details key={row.runId} className="group/request">
              <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-xs hover:bg-neutral-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/40 lg:grid-cols-[11rem_minmax(0,0.8fr)_minmax(0,1.5fr)_minmax(7rem,0.8fr)_7rem_1rem] dark:hover:bg-neutral-800/30 [&::-webkit-details-marker]:hidden">
                <span
                  className={`col-span-2 flex items-center gap-1.5 font-medium lg:col-span-1 ${waiting ? 'text-amber-700 dark:text-amber-400' : 'text-sky-700 dark:text-sky-400'}`}
                >
                  {waiting ? (
                    <Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin"
                    />
                  )}
                  <span>{activeRequestStatus(row)}</span>
                  {retrySeconds != null && (
                    <span className="text-[11px] tabular-nums">
                      {retrySeconds ? `${retrySeconds} 秒后重试` : '即将重试'}
                    </span>
                  )}
                </span>
                <Link
                  to={`/admin/users/${row.userId}`}
                  title={row.username ?? undefined}
                  className="col-start-1 row-start-2 truncate text-neutral-700 hover:text-sky-600 lg:col-start-2 lg:row-start-1 dark:text-neutral-300 dark:hover:text-sky-400"
                >
                  {row.username ?? '已删除用户'}
                </Link>
                <span
                  className="col-start-1 row-start-3 min-w-0 truncate lg:col-start-3 lg:row-start-1"
                  title={[row.modelLabel, row.modelDisplayName, row.providerLabel]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <span className="font-medium text-neutral-800 dark:text-neutral-100">
                    {row.modelLabel ?? '模型已删除'}
                  </span>
                  <span className="ml-2 hidden text-[11px] text-neutral-500 lg:inline dark:text-neutral-400">
                    {row.providerLabel ?? '供应商已删除'}
                    {row.reasoningEffort && ` · ${row.reasoningEffort}`}
                  </span>
                </span>
                <span className="col-start-2 row-start-2 text-right tabular-nums lg:col-start-4 lg:row-start-1 lg:text-left">
                  <span className="font-medium text-neutral-800 dark:text-neutral-100">
                    已用时{' '}
                    {formatRequestLatency(
                      Math.max(
                        0,
                        Math.floor((data.observedAt - (row.startedAt ?? row.createdAt)) / 1000) *
                          1000,
                      ),
                    )}
                  </span>
                  {progress?.requestStartedAt != null && !waiting && progress.attempt > 1 && (
                    <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                      本次请求已用时{' '}
                      {formatRequestLatency(
                        Math.max(
                          0,
                          Math.floor((data.observedAt - progress.requestStartedAt) / 1000) * 1000,
                        ),
                      )}
                    </span>
                  )}
                </span>
                <span className="col-start-2 row-start-3 whitespace-nowrap text-right text-[11px] text-neutral-500 lg:col-start-5 lg:row-start-1 lg:text-left dark:text-neutral-400">
                  {progress
                    ? `第 ${progress.attempt} / ${progress.maxAttempts} 次请求`
                    : '尚未开始请求'}
                </span>
                <span className="col-start-3 row-start-1 lg:col-start-6">
                  <ChevronDown
                    aria-hidden="true"
                    className="h-3.5 w-3.5 text-neutral-400 transition-transform group-open/request:rotate-180"
                  />
                  <span className="sr-only">请求详情</span>
                </span>
                {latestFailure && (
                  <span className="col-span-full break-words text-[11px] leading-5 text-amber-700 dark:text-amber-400">
                    第 {latestFailure.attempt} 次请求 · {retryFailureDurationLabel(latestFailure)}
                    {latestFailure.httpStatus != null && (
                      <span className="whitespace-nowrap">
                        {' · '}HTTP {latestFailure.httpStatus}
                        {latestFailure.httpStatus === 200 ? '（响应中报错）' : ''}
                      </span>
                    )}
                    {' · '}
                    {latestFailure.message}
                  </span>
                )}
              </summary>
              <div className="space-y-2 px-3 pb-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  <span>
                    {row.modelDisplayName ?? row.modelLabel} · {row.providerLabel ?? '供应商已删除'}
                    {row.reasoningEffort && ` · ${row.reasoningEffort}`}
                    {' · '}发起于 {formatDateTime(row.createdAt)}
                  </span>
                  <CopyButton value={row.runId} label="复制运行 ID" />
                </div>
                <RetryAuditDetails summary={row.retrySummary} />
              </div>
            </details>
          )
        })}
      </div>
      {data.total > data.pageSize && (
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={onPage} />
      )}
    </section>
  )
}
