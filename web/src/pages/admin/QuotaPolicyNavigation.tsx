import { useState } from 'react'
import { clsx } from 'clsx'
import { Plus } from 'lucide-react'
import type { AdminQuotaPolicyDTO } from '@shared/types/api'
import { SearchField } from '../../components/ui/SearchField'
import { describeQuotaPolicyBrief } from './quotaPolicyDisplay'

/** 策略少时不必搜索，列表一眼就能看完。 */
const SEARCH_THRESHOLD = 8

/** 策略工作台左栏：快速切换策略或新建。 */
export function QuotaPolicyNavigation({
  policies,
  currentId,
  creating,
  onSelect,
  onCreate,
  disabled,
}: {
  policies: AdminQuotaPolicyDTO[]
  /** null=正在新建 */
  currentId: string | null
  creating: boolean
  onSelect: (policy: AdminQuotaPolicyDTO) => void
  onCreate: () => void
  disabled: boolean
}) {
  const [search, setSearch] = useState('')
  const keyword = search.trim().toLowerCase()
  const matches = policies.filter((policy) =>
    `${policy.name} ${policy.description ?? ''}`.toLowerCase().includes(keyword),
  )
  return (
    <>
      <div className="space-y-2 p-3">
        <button
          type="button"
          disabled={disabled || creating}
          onClick={onCreate}
          className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 text-xs font-medium text-neutral-600 transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-sky-500/50 dark:hover:text-sky-300"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> 新建策略
        </button>
        {policies.length > SEARCH_THRESHOLD && (
          <SearchField placeholder="搜索策略" value={search} onChange={setSearch} />
        )}
      </div>
      <nav
        aria-label="切换额度策略"
        className="hc-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {creating && (
          <div
            aria-current="true"
            className="mb-0.5 rounded-lg bg-sky-100/70 px-2.5 py-2 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300"
          >
            <span className="block truncate text-xs font-medium">新策略</span>
            <span className="block text-[11px] leading-4 opacity-70">尚未保存</span>
          </div>
        )}
        {matches.map((policy) => (
          <button
            key={policy.id}
            type="button"
            aria-label={`切换到 ${policy.name}`}
            disabled={disabled}
            aria-current={policy.id === currentId ? 'true' : undefined}
            onClick={() => onSelect(policy)}
            className={clsx(
              'mb-0.5 block w-full rounded-lg px-2.5 py-2 text-left disabled:opacity-50',
              policy.id === currentId
                ? 'bg-sky-100/70 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300'
                : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs font-medium">{policy.name}</span>
              {policy.isDefault && (
                <span className="shrink-0 rounded bg-sky-100 px-1 text-[10px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                  默认
                </span>
              )}
            </span>
            <span className="block truncate text-[11px] leading-4 text-neutral-500">
              {describeQuotaPolicyBrief(policy)}
            </span>
          </button>
        ))}
        {!matches.length && !creating && (
          <p className="px-2 py-6 text-center text-xs text-neutral-500">没有匹配的策略</p>
        )}
      </nav>
      <p className="px-4 py-2 text-[11px] text-neutral-500">{policies.length} 个策略</p>
    </>
  )
}
