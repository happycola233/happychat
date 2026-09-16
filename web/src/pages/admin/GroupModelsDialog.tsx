import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminModelGroupDTO } from '@shared/types/api'
import { assignModelsToGroup, listAdminModels, listAdminModelGroups } from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { LoadError } from '../../components/ui/LoadError'
import { SearchField } from '../../components/ui/SearchField'
import { Spinner } from '../../components/ui/Spinner'
import { toast } from '../../store/toast'

export function GroupModelsDialog({
  group,
  onClose,
}: {
  group: AdminModelGroupDTO
  onClose: () => void
}) {
  const qc = useQueryClient()
  const {
    data: models,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'models'],
    queryFn: listAdminModels,
  })
  const { data: groups } = useQuery({
    queryKey: ['admin', 'model-groups'],
    queryFn: listAdminModelGroups,
  })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const keyword = search.trim().toLowerCase()
  const candidates = (models ?? []).filter(
    (model) =>
      model.groupId !== group.id &&
      `${model.displayName} ${model.modelId} ${model.providerName}`.toLowerCase().includes(keyword),
  )
  const allSelected =
    candidates.length > 0 && candidates.every((model) => selected.includes(model.id))
  const save = useMutation({
    mutationFn: () => assignModelsToGroup({ groupId: group.id, modelIds: selected }),
    onSuccess: (result) => {
      toast.success(`已将 ${result.moved} 个模型加入「${group.name}」`)
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'model-groups'] })
      void qc.invalidateQueries({ queryKey: ['models'] })
      onClose()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '添加失败'),
  })
  return (
    <Modal
      open
      dismissible={!save.isPending}
      title={`添加模型 · ${group.name}`}
      onClose={onClose}
      size="form"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-neutral-500">
            已选 {selected.length} 个
          </span>
          <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!selected.length}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            加入分组
          </Button>
        </>
      }
    >
      <fieldset className="space-y-3" disabled={save.isPending}>
        <SearchField value={search} onChange={setSearch} placeholder="搜索模型或供应商" />
        <p className="text-xs text-neutral-500">已有分组的模型将移入此分组，模型配置保持不变。</p>
        {isError && <LoadError hasData={Boolean(models)} onRetry={() => void refetch()} />}
        {isError && !models ? null : isLoading ? (
          <Spinner />
        ) : candidates.length === 0 ? (
          <EmptyState title="没有可添加的模型" />
        ) : (
          <>
            <label className="flex min-h-8 items-center gap-2 text-xs text-neutral-500">
              <Checkbox
                ariaLabel="全选搜索结果"
                checked={allSelected}
                indeterminate={
                  !allSelected && candidates.some((model) => selected.includes(model.id))
                }
                onChange={(checked) =>
                  setSelected((current) =>
                    checked
                      ? [...new Set([...current, ...candidates.map((model) => model.id)])]
                      : current.filter((id) => !candidates.some((model) => model.id === id)),
                  )
                }
              />
              全选搜索结果 · {candidates.length} 个
            </label>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {candidates.map((model) => (
                <label
                  key={model.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                >
                  <Checkbox
                    checked={selected.includes(model.id)}
                    ariaLabel={`选择 ${model.displayName}`}
                    onChange={(checked) =>
                      setSelected((current) =>
                        checked ? [...current, model.id] : current.filter((id) => id !== model.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{model.displayName}</span>
                    <span className="block truncate text-xs text-neutral-400">
                      {model.modelId} · {model.providerName}
                    </span>
                  </span>
                  <span className="max-w-28 truncate text-xs text-neutral-500">
                    {groups?.find((item) => item.id === model.groupId)?.name ?? '未分组'}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>
    </Modal>
  )
}
