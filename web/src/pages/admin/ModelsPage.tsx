import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import type { AdminModelDTO } from '@shared/types/api'
import type { ModelCapabilities } from '@shared/types/domain'
import * as adminApi from '../../api/admin'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { Toggle } from '../../components/ui/Toggle'
import { toast } from '../../store/toast'
import { ModelEditor } from './ModelEditor'

const CAP_BADGE: Partial<Record<keyof ModelCapabilities, string>> = {
  vision: '视觉',
  file_input: '文件',
  web_search: '联网',
  image_generation: '生图',
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
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">模型</h1>
          <p className="mt-1 text-sm text-neutral-500">
            同步或手动添加模型：启用/禁用、能力、默认参数、定价、系统提示词与请求体硬参数
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
        <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-3 font-medium">模型</th>
                <th className="px-4 py-3 font-medium">能力</th>
                <th className="px-4 py-3 font-medium">启用</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {models.map((m) => (
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
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorOpen && <ModelEditor model={editorModel} onClose={() => setEditorOpen(false)} />}
    </div>
  )
}
