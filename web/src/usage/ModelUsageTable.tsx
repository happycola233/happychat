import { clsx } from 'clsx'
import type { UsageModelStatDTO } from '@shared/types/api'
import { formatQuotaCostUsd } from '@shared/util/quota'
import { formatCompact, formatInt } from '../lib/format'

/**
 * 分模型用量表：兼作热力图与柱图的「表格视图」（无障碍要求的替代读法）。
 * 行内条形只表达占比，数值仍以文字给出，不依赖颜色传达信息。
 */
export function ModelUsageTable({ rows }: { rows: UsageModelStatDTO[] }) {
  const maxRequests = Math.max(1, ...rows.map((row) => row.requests))

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
        模型使用构成
      </h2>
      <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
        按请求次数排序；花费按请求时的价格快照估算。
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-400 dark:bg-neutral-800/50 dark:text-neutral-500">
          这段时间还没有用量记录
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
              <th className="pb-2 text-left font-medium">模型</th>
              <th className="pb-2 text-right font-medium">请求</th>
              <th className="hidden pb-2 text-right font-medium sm:table-cell">Token</th>
              <th className="pb-2 text-right font-medium">花费</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.modelId ?? ''}:${row.modelLabel}`}
                className={clsx(
                  'border-t border-neutral-100 dark:border-neutral-800',
                  index === 0 && 'border-t-0',
                )}
              >
                <td className="py-2 pr-3">
                  <div className="truncate text-neutral-800 dark:text-neutral-100">
                    {row.modelLabel}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-sky-500/70 dark:bg-sky-400/70"
                      style={{ width: `${Math.max(2, (row.requests / maxRequests) * 100)}%` }}
                    />
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
                  {formatInt(row.requests)}
                </td>
                <td className="hidden py-2 text-right tabular-nums text-neutral-500 sm:table-cell dark:text-neutral-400">
                  {formatCompact(row.totalTokens)}
                </td>
                <td className="py-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                  {formatQuotaCostUsd(row.costUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
