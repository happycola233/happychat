import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import type { AdminModelDTO } from '@shared/types/api'
import { SearchField } from '../../components/ui/SearchField'

export function ModelEditorNavigation({
  models,
  currentId,
  search,
  onSearch,
  onSelect,
  disabled,
}: {
  models: AdminModelDTO[]
  currentId: string
  search: string
  onSearch: (value: string) => void
  onSelect: (model: AdminModelDTO) => void
  disabled: boolean
}) {
  const activeRef = useRef<HTMLButtonElement>(null)
  const keyword = search.trim().toLowerCase()
  const matches = models.filter((model) =>
    `${model.displayName} ${model.modelId} ${model.providerName}`.toLowerCase().includes(keyword),
  )
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentId])
  return (
    <>
      <div className="p-3">
        <SearchField placeholder="搜索模型" value={search} onChange={onSearch} />
      </div>
      <nav
        aria-label="切换配置模型"
        className="hc-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {matches.map((model) => (
          <button
            key={model.id}
            ref={model.id === currentId ? activeRef : undefined}
            type="button"
            aria-label={`切换到 ${model.displayName}`}
            disabled={disabled}
            aria-current={model.id === currentId ? 'true' : undefined}
            onClick={() => onSelect(model)}
            className={clsx(
              'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left disabled:opacity-50',
              model.id === currentId
                ? 'bg-sky-100/70 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300'
                : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
            )}
          >
            <span
              className={clsx(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                model.enabled ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-600',
              )}
              title={model.enabled ? '已启用' : '已停用'}
            />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">{model.displayName}</span>
              <span className="block truncate text-[11px] leading-4 text-neutral-500">
                {model.providerName} · {model.modelId}
              </span>
            </span>
          </button>
        ))}
        {!matches.length && (
          <p className="px-2 py-6 text-center text-xs text-neutral-500">没有匹配的模型</p>
        )}
      </nav>
      <p className="px-4 py-2 text-[11px] text-neutral-500">{matches.length} 个模型</p>
    </>
  )
}
