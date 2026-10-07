import type { ReactNode } from 'react'
import type { RequestCostBreakdown } from '@shared/types/domain'
import { formatUsd } from '../lib/format'

/** 桌面和触屏均可展开；使用同一快照展示聊天、生图与统计缺口。 */
export function CostBreakdown({
  breakdown,
  children,
}: {
  breakdown?: RequestCostBreakdown | null
  children: ReactNode
}) {
  if (
    !breakdown ||
    (breakdown.imageCount === 0 && breakdown.imageStatus === 'complete' && breakdown.imageUsd === 0)
  )
    return <>{children}</>
  const incomplete = breakdown.imageStatus !== 'complete'
  return (
    <details className="max-w-full text-xs">
      <summary className="cursor-pointer list-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50">
        <span className="inline-flex items-center gap-1">
          {children}
          <span aria-hidden="true">⌄</span>
        </span>
        {incomplete && (
          <span className="mt-1 block whitespace-normal text-amber-700 dark:text-amber-400">
            图片费用未完整统计
          </span>
        )}
      </summary>
      <div className="mt-2 space-y-1 whitespace-normal rounded-lg bg-neutral-100 p-2.5 font-normal text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        <div>聊天：{formatUsd(breakdown.chatUsd)}</div>
        <div>
          图片生成：{formatUsd(breakdown.imageUsd)}
          {incomplete ? '（已统计部分）' : ''}
        </div>
        <div>生成图片：{breakdown.imageCount} 张</div>
        <div>合计：{formatUsd(breakdown.totalUsd)} USD</div>
        {incomplete && (
          <p className="max-w-64 text-amber-700 dark:text-amber-400">
            {breakdown.imageStatus === 'missing_usage'
              ? '供应商未返回完整生图用量或图片规格。'
              : '部分图片尚未配置可用价格。'}
          </p>
        )}
      </div>
    </details>
  )
}
