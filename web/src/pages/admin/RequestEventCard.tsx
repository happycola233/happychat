import { Link } from 'react-router-dom'
import type { UsageLogDTO } from '@shared/types/api'
import { formatInt, formatUsd } from '../../lib/format'
import { CopyButton } from '../../components/ui/CopyButton'
import { RequestKindBadge } from './RequestKindBadge'
import { RequestOutcomeBadge } from './RequestOutcomeBadge'
import { RequestGeneratedImagesBadge } from './RequestGeneratedImagesBadge'
import {
  formatCacheRate,
  formatGenerationSpeed,
  formatRequestEventTimestamp,
  formatRequestLatency,
} from './requestEventDisplay'

/** 小屏先扫读结果与关键用量，再按需展开计时和 Token 明细。 */
export function RequestEventCard({ row }: { row: UsageLogDTO }) {
  const time = formatRequestEventTimestamp(row.createdAt)
  return (
    <article className="min-w-0 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900/60">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {row.modelDisplayName || row.modelLabel || '未知模型'}
          </p>
          <p className="mt-1 truncate text-xs text-neutral-500">
            {row.providerLabel || '—'} · {row.reasoningEffort || '默认'}
          </p>
        </div>
        <RequestOutcomeBadge
          kind={row.kind}
          result={row.result}
          terminalReason={row.terminalReason}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
        {row.userId ? (
          <Link to={`/admin/users/${row.userId}`} className="text-sky-600 dark:text-sky-400">
            {row.username || '用户'}
          </Link>
        ) : (
          <span>{row.username || '已删除用户'}</span>
        )}
        <span>
          {time.date} {time.time}
        </span>
        <RequestKindBadge kind={row.kind} />
        <RequestGeneratedImagesBadge row={row} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: '总耗时', value: formatRequestLatency(row.durationMs) },
          { label: 'Tokens', value: formatInt(row.totalTokens) },
          { label: '成本', value: formatUsd(row.costUsd) },
        ].map((metric) => (
          <div key={metric.label}>
            <dt className="text-[11px] text-neutral-500">{metric.label}</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <details className="mt-3">
        <summary className="min-h-7 cursor-pointer text-xs text-neutral-500">请求明细</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {[
            { label: '上游首响应', value: formatRequestLatency(row.upstreamResponseLatencyMs) },
            { label: '首字延迟', value: formatRequestLatency(row.firstTokenLatencyMs) },
            { label: '生成速度', value: formatGenerationSpeed(row.generationTokensPerSecond) },
            { label: '缓存读取率', value: formatCacheRate(row.cachedTokens, row.inputTokens) },
            {
              label: '输入 / 输出',
              value: `${formatInt(row.inputTokens)} / ${formatInt(row.outputTokens)}`,
            },
            { label: '推理 Token', value: formatInt(row.reasoningTokens) },
            {
              label: '缓存读取 / 写入',
              value: `${formatInt(row.cachedTokens)} / ${formatInt(row.cacheWriteTokens)}`,
            },
          ].map((metric) => (
            <div key={metric.label}>
              <dt className="text-neutral-500">{metric.label}</dt>
              <dd className="mt-0.5 tabular-nums">{metric.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2 flex justify-end">
          <CopyButton value={row.id} label="复制事件 ID" />
        </div>
      </details>
    </article>
  )
}
