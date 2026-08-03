import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { ArrowRight, FolderInput, Sparkles } from 'lucide-react'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import type { ModelIcon } from '@shared/types/domain'
import { sameModelIcon } from '@shared/util/modelIcon'
import { guessModelIconSlug } from '@shared/util/modelIconGuess'
import * as adminApi from '../../api/admin'
import {
  DEFAULT_MODEL_ICON_TONE_CLASS,
  ModelGroupGlyph,
  ModelIconMark,
} from '../../components/ModelIcon'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { toast } from '../../store/toast'

/** 分组/图标批量写入后，管理端与用户端两份模型列表都必须刷新。 */
function useModelListInvalidation() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'models'] })
    void qc.invalidateQueries({ queryKey: ['admin', 'model-groups'] })
    void qc.invalidateQueries({ queryKey: ['models'] })
  }
}

/** 批量移动到分组：列出全部分组 + 「移出分组」，点选即执行。 */
export function AssignGroupDialog({
  models,
  groups,
  onClose,
  onDone,
}: {
  models: AdminModelDTO[]
  groups: AdminModelGroupDTO[]
  onClose: () => void
  onDone: () => void
}) {
  const invalidate = useModelListInvalidation()
  const assign = useMutation({
    mutationFn: (groupId: string | null) =>
      adminApi.assignModelsToGroup({ groupId, modelIds: models.map((m) => m.id) }),
    onSuccess: (result) => {
      toast.success(`已移动 ${result.moved} 个模型`)
      invalidate()
      onDone()
      onClose()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '移动失败'),
  })

  return (
    <Modal
      open
      onClose={assign.isPending ? () => {} : onClose}
      title={`移动 ${models.length} 个模型到分组`}
      size="form"
      footer={
        <Button variant="secondary" onClick={onClose} disabled={assign.isPending}>
          取消
        </Button>
      }
    >
      <div className="max-h-[50vh] space-y-1 overflow-y-auto">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            disabled={assign.isPending}
            onClick={() => assign.mutate(group.id)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800"
          >
            <ModelGroupGlyph group={group} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-100">
              {group.name}
            </span>
            <span className="shrink-0 text-xs text-neutral-400">{group.modelCount} 个模型</span>
          </button>
        ))}
        <button
          type="button"
          disabled={assign.isPending}
          onClick={() => assign.mutate(null)}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800"
        >
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-neutral-200/70 text-neutral-500 dark:bg-neutral-700/60 dark:text-neutral-300"
          >
            <FolderInput className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-500 dark:text-neutral-400">
            移出分组（未分组）
          </span>
        </button>
        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-neutral-400">
            还没有分组，请先到「模型分组」页新建。
          </p>
        )}
      </div>
    </Modal>
  )
}

interface IconDiff {
  model: AdminModelDTO
  next: ModelIcon | null
}

/**
 * 批量识别图标：按模型 ID 猜出品牌图标，先展示「现在 → 识别后」的差异，确认后才写库。
 * 只列出真正会变化的模型；已经手工配过且与识别结果一致的不重复写。
 */
export function BatchIconDialog({
  models,
  onClose,
  onDone,
}: {
  models: AdminModelDTO[]
  onClose: () => void
  onDone: () => void
}) {
  const invalidate = useModelListInvalidation()
  /** 默认不覆盖管理员已手工设置的图标；勾上则连同已设置的一起按识别结果重写。 */
  const [overwriteExisting, setOverwriteExisting] = useState(false)

  const diffs = useMemo<IconDiff[]>(() => {
    const result: IconDiff[] = []
    for (const model of models) {
      if (model.icon && !overwriteExisting) continue
      const slug = guessModelIconSlug(model.modelId, model.displayName)
      const next: ModelIcon | null = slug ? { type: 'lobe', slug } : null
      if (sameModelIcon(model.icon, next)) continue
      // 识别不出来时不要把已有图标抹成空。
      if (next === null) continue
      result.push({ model, next })
    }
    return result
  }, [models, overwriteExisting])

  const apply = useMutation({
    mutationFn: () =>
      adminApi.applyModelIcons({
        items: diffs.map((diff) => ({ id: diff.model.id, icon: diff.next })),
      }),
    onSuccess: (result) => {
      toast.success(`已为 ${result.updated} 个模型套用图标`)
      invalidate()
      onDone()
      onClose()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '套用失败'),
  })

  return (
    <Modal
      open
      onClose={apply.isPending ? () => {} : onClose}
      title="批量识别图标"
      size="form"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={apply.isPending}>
            取消
          </Button>
          <Button
            onClick={() => apply.mutate()}
            disabled={diffs.length === 0 || apply.isPending}
            loading={apply.isPending}
          >
            套用 {diffs.length} 项
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2.5 text-sm dark:bg-neutral-900/60">
          <Checkbox
            checked={overwriteExisting}
            onChange={setOverwriteExisting}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="text-neutral-700 dark:text-neutral-200">覆盖已设置的图标</span>
            <span className="mt-0.5 block text-xs text-neutral-400">
              默认只处理未设置图标的模型，避免冲掉你手工挑过的图标
            </span>
          </span>
        </label>

        {diffs.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={
              overwriteExisting
                ? '所选模型的图标都已与识别结果一致'
                : '所选模型都已设置图标；如需按品牌重写，请勾选上方选项'
            }
          />
        ) : (
          <div className="max-h-[42vh] divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
            {diffs.map(({ model, next }) => (
              <div key={model.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-neutral-800 dark:text-neutral-100">
                    {model.displayName}
                  </div>
                  <div className="truncate text-xs text-neutral-400">{model.modelId}</div>
                </div>
                <div
                  className={`flex shrink-0 items-center gap-2 ${DEFAULT_MODEL_ICON_TONE_CLASS}`}
                >
                  <ModelIconMark icon={model.icon} displayName={model.displayName} size="md" />
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 text-neutral-300" />
                  <ModelIconMark icon={next} displayName={model.displayName} size="md" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 批量模式底部工具栏：与侧边栏批量管理的信息层级一致（计数 + 全选 + 完成 / 操作行）。 */
export function ModelBatchToolbar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
  onAssign,
  onDetectIcons,
  onExit,
}: {
  selectedCount: number
  totalCount: number
  onSelectAll: () => void
  onClear: () => void
  onAssign: () => void
  onDetectIcons: () => void
  onExit: () => void
}) {
  const hasSelection = selectedCount > 0
  const allSelected = selectedCount === totalCount && totalCount > 0
  return (
    <div
      data-testid="model-batch-toolbar"
      className="sticky bottom-4 z-20 rounded-xl border border-neutral-200 bg-white/95 p-2.5 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95"
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-600 dark:text-neutral-300">
          {hasSelection ? `已选择 ${selectedCount} 个模型` : '选择要批量处理的模型'}
        </span>
        <button
          type="button"
          onClick={allSelected ? onClear : onSelectAll}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          {allSelected ? '取消全选' : '全选'}
        </button>
        <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={onExit}>
          完成
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          disabled={!hasSelection}
          onClick={onAssign}
          className={clsx(
            'flex flex-col items-center gap-1 rounded-lg py-2 text-xs transition',
            hasSelection
              ? 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
              : 'cursor-not-allowed text-neutral-300 dark:text-neutral-600',
          )}
        >
          <FolderInput className="h-4 w-4" />
          移动到分组
        </button>
        <button
          type="button"
          disabled={!hasSelection}
          onClick={onDetectIcons}
          className={clsx(
            'flex flex-col items-center gap-1 rounded-lg py-2 text-xs transition',
            hasSelection
              ? 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
              : 'cursor-not-allowed text-neutral-300 dark:text-neutral-600',
          )}
        >
          <Sparkles className="h-4 w-4" />
          批量识别图标
        </button>
      </div>
    </div>
  )
}
