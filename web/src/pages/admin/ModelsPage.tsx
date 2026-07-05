import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import type { AdminModelDTO } from '@shared/types/api'
import type { ModelCapabilities } from '@shared/types/domain'
import * as adminApi from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { tableScroll, tableShell } from '../../components/ui/tableStyles'
import { Toggle } from '../../components/ui/Toggle'
import { toast } from '../../store/toast'
import { DeleteIcon } from '../../chat/icons'
import { ModelEditor } from './ModelEditor'

const CAP_BADGE: Partial<Record<keyof ModelCapabilities, string>> = {
  vision: '视觉',
  file_input: '文件',
  web_search: '联网',
  reasoning: '思考',
}

export default function ModelsPage() {
  const qc = useQueryClient()
  const { data: models, isLoading } = useQuery({
    queryKey: ['admin', 'models'],
    queryFn: adminApi.listAdminModels,
  })
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorModel, setEditorModel] = useState<AdminModelDTO | null>(null)

  const openCreate = () => {
    setEditorModel(null)
    setEditorOpen(true)
  }
  const openEdit = (m: AdminModelDTO) => {
    setEditorModel(m)
    setEditorOpen(true)
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'models'] })

  const reorder = useMutation({
    mutationFn: adminApi.reorderModels,
    onMutate: async ({ modelIds }) => {
      await qc.cancelQueries({ queryKey: ['admin', 'models'] })
      const previous = qc.getQueryData<AdminModelDTO[]>(['admin', 'models'])
      if (previous) {
        const byId = new Map(previous.map((m) => [m.id, m]))
        // 立即更新列表顺序与 sort 快照，让管理端和聊天端看到同一套排序语义。
        qc.setQueryData<AdminModelDTO[]>(
          ['admin', 'models'],
          modelIds.map((id, index) => ({ ...byId.get(id)!, sort: (index + 1) * 100 })),
        )
      }
      return { previous }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] })
    },
    onError: (e, _variables, context) => {
      if (context?.previous) qc.setQueryData(['admin', 'models'], context.previous)
      toast.error(e instanceof Error ? e.message : '排序失败')
    },
    onSettled: () => {
      invalidate()
    },
  })

  const toggleEnabled = useMutation({
    mutationFn: (m: AdminModelDTO) => adminApi.updateModel(m.id, { enabled: !m.enabled }),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['models'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  })

  const remove = useMutation({
    mutationFn: adminApi.deleteModel,
    onSuccess: () => {
      toast.success('已删除')
      invalidate()
      qc.invalidateQueries({ queryKey: ['models'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  const moveModel = (index: number, direction: -1 | 1) => {
    if (!models || reorder.isPending) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= models.length) return

    const next = [...models]
    const current = next[index]
    const target = next[nextIndex]
    if (!current || !target) return
    next[index] = target
    next[nextIndex] = current
    reorder.mutate({ modelIds: next.map((m) => m.id) })
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">模型</h1>
          <p className="mt-1 text-sm text-neutral-500">
            同步或手动添加模型：顺序、启用/禁用、能力、默认参数、定价、系统提示词与请求体硬参数
          </p>
        </div>
        <Button className="shrink-0" onClick={openCreate}>
          <Plus className="h-4 w-4" /> 添加模型
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !models?.length ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-700">
          还没有模型，请在「提供商」页同步，或点右上角「添加模型」手动添加。
        </div>
      ) : (
        <div className={tableScroll}>
          <div className={`${tableShell} min-w-[760px]`}>
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">
                <tr>
                  <th className="px-4 py-3 font-medium">模型</th>
                  <th className="px-4 py-3 font-medium">能力</th>
                  <th className="px-4 py-3 font-medium">启用</th>
                  <th className="px-4 py-3 font-medium">顺序</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {models.map((m, index) => (
                  <tr key={m.id} className="bg-white dark:bg-neutral-900">
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900 dark:text-neutral-100">
                        {m.displayName}
                      </div>
                      <div className="text-xs text-neutral-400">
                        {m.modelId} · {m.providerName} ·{' '}
                        {m.kind === 'image' ? '图片模型' : '对话模型'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(Object.keys(CAP_BADGE) as (keyof ModelCapabilities)[])
                          .filter((k) => m.capabilities[k])
                          .map((k) => (
                            <span
                              key={k}
                              className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                            >
                              {CAP_BADGE[k]}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Toggle checked={m.enabled} onChange={() => toggleEnabled.mutate(m)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <button
                          type="button"
                          title="上移"
                          aria-label={`上移 ${m.displayName}`}
                          disabled={index === 0 || reorder.isPending}
                          onClick={() => moveModel(index, -1)}
                          className="flex h-7 w-8 items-center justify-center text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <span className="h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
                        <button
                          type="button"
                          title="下移"
                          aria-label={`下移 ${m.displayName}`}
                          disabled={index === models.length - 1 || reorder.isPending}
                          onClick={() => moveModel(index, 1)}
                          className="flex h-7 w-8 items-center justify-center text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        className="!px-2.5 !py-1 text-xs"
                        onClick={() => openEdit(m)}
                      >
                        配置
                      </Button>
                      <Button
                        variant="ghost"
                        className="!px-2.5 !py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                        onClick={() => {
                          if (confirm(`确定删除模型「${m.displayName}」？`)) remove.mutate(m.id)
                        }}
                      >
                        <DeleteIcon className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editorOpen && <ModelEditor model={editorModel} onClose={() => setEditorOpen(false)} />}
    </div>
  )
}
