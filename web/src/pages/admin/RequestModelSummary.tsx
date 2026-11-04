import { Link } from 'react-router-dom'
import type { UsageLogDTO } from '@shared/types/api'
import { RequestKindBadge } from './RequestKindBadge'

const secondaryLine =
  'max-w-[180px] truncate whitespace-nowrap text-[10px] leading-[14px] text-neutral-400 dark:text-neutral-500'

/**
 * 请求所属的模型配置与实际走的线路。
 *
 * 第一行是配置名（配置仍存在时可直达编辑）；同名配置下一行附区分说明；
 * 最后一行是这次实际承接请求的「供应商 · 上游模型 ID」。
 */
export function RequestModelSummary({
  row,
  hint,
}: {
  row: Pick<UsageLogDTO, 'modelId' | 'modelDisplayName' | 'modelLabel' | 'providerLabel' | 'kind'>
  hint: string | null | undefined
}) {
  const name = row.modelDisplayName ?? row.modelLabel ?? '已删除模型'
  const route = [row.providerLabel ?? '已删除供应商', row.modelLabel].filter(Boolean).join(' · ')
  return (
    <>
      <div
        className="max-w-[180px] truncate whitespace-nowrap text-xs font-semibold leading-4 text-neutral-800 dark:text-neutral-100"
        title={name}
      >
        {row.modelId ? (
          <Link
            to={`/admin/models?edit=${encodeURIComponent(row.modelId)}`}
            className="hover:text-sky-600 dark:hover:text-sky-400"
          >
            {name}
          </Link>
        ) : (
          name
        )}
      </div>
      {hint && (
        <div className={secondaryLine} title={hint}>
          {hint}
        </div>
      )}
      <div className={`${secondaryLine} flex items-center gap-1`}>
        <span className="truncate" title={route}>
          {route}
        </span>
        <RequestKindBadge kind={row.kind} />
      </div>
    </>
  )
}
