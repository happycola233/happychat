import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { clsx } from 'clsx'
import { FolderTree, GripVertical, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { AdminModelGroupDTO } from '@shared/types/api'
import * as adminApi from '../../api/admin'
import { ModelGroupGlyph } from '../../components/ModelIcon'
import { Button } from '../../components/ui/Button'
import { cardSurface } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { PageHeader } from '../../components/ui/PageHeader'
import { Spinner } from '../../components/ui/Spinner'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { ModelGroupEditor } from './ModelGroupEditor'

function GroupRow({
  group,
  onEdit,
  onDelete,
}: {
  group: AdminModelGroupDTO
  onEdit: () => void
  onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'flex items-center gap-2 px-3 py-2.5',
        isDragging && 'relative z-10 bg-white shadow-lg dark:bg-neutral-800',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`拖拽排序「${group.name}」`}
        className="flex h-8 w-6 cursor-grab items-center justify-center text-neutral-300 transition hover:text-neutral-500 active:cursor-grabbing dark:text-neutral-600 dark:hover:text-neutral-400"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <ModelGroupGlyph group={group} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
          {group.name}
        </div>
        <div className="text-xs text-neutral-400 dark:text-neutral-500">
          {group.modelCount > 0 ? `${group.modelCount} 个模型` : '暂无模型'}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="编辑分组" onClick={onEdit}>
          <SlidersHorizontal className="h-4 w-4" />
        </IconButton>
        <IconButton label="删除分组" tone="danger" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  )
}

/**
 * 模型分组管理：新建 / 重命名 / 改图标与配色 / 拖拽排序 / 删除。
 * 分组顺序即用户端选择器里分区的先后顺序，因此这里的拖拽是唯一的排序入口。
 */
export default function ModelGroupsPage() {
  const qc = useQueryClient()
  const { data: groups, isPending } = useQuery({
    queryKey: ['admin', 'model-groups'],
    queryFn: adminApi.listAdminModelGroups,
  })
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorGroup, setEditorGroup] = useState<AdminModelGroupDTO | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'model-groups'] })
    void qc.invalidateQueries({ queryKey: ['models'] })
  }

  const reorder = useMutation({
    mutationFn: adminApi.reorderModelGroups,
    // 乐观更新：拖拽必须立刻定位，否则手指松开后会看到一次回弹。
    onMutate: async ({ groupIds }) => {
      await qc.cancelQueries({ queryKey: ['admin', 'model-groups'] })
      const previous = qc.getQueryData<AdminModelGroupDTO[]>(['admin', 'model-groups'])
      if (previous) {
        const byId = new Map(previous.map((g) => [g.id, g]))
        qc.setQueryData<AdminModelGroupDTO[]>(
          ['admin', 'model-groups'],
          groupIds.map((id, index) => ({ ...byId.get(id)!, sort: (index + 1) * 100 })),
        )
      }
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) qc.setQueryData(['admin', 'model-groups'], context.previous)
      toast.error(error instanceof Error ? error.message : '排序失败')
    },
    onSettled: invalidate,
  })

  const remove = useMutation({
    mutationFn: adminApi.deleteModelGroup,
    onSuccess: () => {
      toast.success('已删除分组')
      invalidate()
      // 组内模型已回到未分组，管理端模型列表也要刷新。
      void qc.invalidateQueries({ queryKey: ['admin', 'models'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '删除失败'),
  })

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!groups || !over || active.id === over.id || reorder.isPending) return
    const ids = groups.map((g) => g.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    reorder.mutate({ groupIds: arrayMove(ids, oldIndex, newIndex) })
  }

  const openCreate = () => {
    setEditorGroup(null)
    setEditorOpen(true)
  }
  const openEdit = (group: AdminModelGroupDTO) => {
    setEditorGroup(group)
    setEditorOpen(true)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="模型分组"
        description="分组决定用户端模型选择器里的分区结构与顺序；把模型加入分组请到「模型」页使用批量管理。"
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            新建分组
          </Button>
        }
      />

      <div className={cardSurface}>
        {isPending ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !groups?.length ? (
          <EmptyState
            icon={FolderTree}
            title="还没有模型分组"
            action={
              <Button variant="secondary" onClick={openCreate}>
                新建第一个分组
              </Button>
            }
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={groups.map((g) => g.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {groups.map((group) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    onEdit={() => openEdit(group)}
                    onDelete={() => {
                      void askConfirm({
                        title: '删除分组？',
                        description:
                          group.modelCount > 0
                            ? `「${group.name}」下的 ${group.modelCount} 个模型会移到未分组，模型本身不会被删除。`
                            : `确认删除「${group.name}」？`,
                        confirmLabel: '删除',
                        tone: 'danger',
                      }).then((ok) => {
                        if (ok) remove.mutate(group.id)
                      })
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {editorOpen && (
        <ModelGroupEditor group={editorGroup} onClose={() => setEditorOpen(false)} />
      )}
    </div>
  )
}
