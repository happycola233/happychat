import { useMemo, useState } from 'react'
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
import {
  Boxes,
  FolderTree,
  GripVertical,
  ListChecks,
  Plus,
  Search,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import type { ModelCapabilities } from '@shared/types/domain'
import * as adminApi from '../../api/admin'
import {
  DEFAULT_MODEL_ICON_TONE_CLASS,
  ModelGroupGlyph,
  ModelIconMark,
} from '../../components/ModelIcon'
import { ModelTagList } from '../../components/ModelTags'
import { Button } from '../../components/ui/Button'
import { cardSurface } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Checkbox } from '../../components/ui/Checkbox'
import { PageHeader } from '../../components/ui/PageHeader'
import { Select, type SelectOption } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { Toggle } from '../../components/ui/Toggle'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { DeleteIcon } from '../../chat/icons'
import { ModelAccessDialog } from './ModelAccessDialog'
import { ModelEditor } from './ModelEditor'
import { AssignGroupDialog, BatchIconDialog, ModelBatchToolbar } from './ModelBatchTools'

const CAP_BADGE: Partial<Record<keyof ModelCapabilities, string>> = {
  vision: '视觉',
  file_input: '文件',
  web_search: '联网',
  x_search: 'X 搜索',
  reasoning: '思考',
}

/**
 * 列表行的共享横向度量：模型行、分组标题、空分组占位共用同一套内边距、列间距与图标列宽度，
 * 保证「分组名 / 模型名 / 提示文案」三者的左基线严格对齐。
 */
const ROW_INSET_X = 'px-2 sm:px-3'
const ROW_GAP_X = 'gap-2 sm:gap-3'
/** 与模型行 ModelIconMark size="md" 等宽的图标列，无图标时用同尺寸占位。 */
const ROW_ICON_COLUMN = 'h-5 w-5 shrink-0'

function kindLabel(m: AdminModelDTO): string {
  if (m.kind === 'image') return '图片模型'
  if (m.kind === 'anthropic') return '对话模型（Anthropic）'
  return m.kind === 'chat' ? '对话模型（chat）' : '对话模型'
}

/** 单行模型：拖拽手柄 + 信息 + 能力 + 启用开关 + 对齐的操作按钮。 */
function ModelRow({
  model,
  sortable,
  batchMode,
  selected,
  onToggleSelected,
  onEdit,
  onAccess,
  onToggle,
  togglePending,
  onDelete,
}: {
  model: AdminModelDTO
  /** 筛选或分组视图生效时禁用拖拽（无法对子集可靠排序）。 */
  sortable: boolean
  batchMode: boolean
  selected: boolean
  onToggleSelected: () => void
  onEdit: () => void
  onAccess: () => void
  onToggle: () => void
  togglePending: boolean
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
  } = useSortable({ id: model.id, disabled: !sortable })

  const caps = (Object.keys(CAP_BADGE) as (keyof ModelCapabilities)[]).filter(
    (k) => model.capabilities[k],
  )
  const accessLabel =
    model.accessMode === 'all'
      ? '全部用户'
      : model.allowedUserCount > 0
        ? `指定 ${model.allowedUserCount} 人`
        : '未选择用户'

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={batchMode ? onToggleSelected : undefined}
      className={clsx(
        'flex items-center py-2.5',
        ROW_INSET_X,
        ROW_GAP_X,
        batchMode
          ? clsx(
              'cursor-pointer',
              selected ? 'bg-sky-50 dark:bg-sky-950/30' : 'bg-white dark:bg-neutral-900',
            )
          : 'bg-white dark:bg-neutral-900',
        isDragging &&
          'relative z-10 rounded-xl shadow-lg ring-1 ring-neutral-200 dark:shadow-black/40 dark:ring-neutral-700',
      )}
    >
      {batchMode ? (
        <span
          className="flex h-8 w-6 shrink-0 items-center justify-center"
          onClick={(event) => event.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onChange={onToggleSelected}
            ariaLabel={`选择 ${model.displayName}`}
          />
        </span>
      ) : (
        sortable && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`拖动排序 ${model.displayName}`}
            className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-neutral-300 transition hover:bg-neutral-100 hover:text-neutral-500 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-400"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )
      )}

      <ModelIconMark
        icon={model.icon}
        modelId={model.modelId}
        displayName={model.displayName}
        size="md"
        className={DEFAULT_MODEL_ICON_TONE_CLASS}
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {model.displayName}
          </span>
          <ModelTagList tags={model.tags} />
        </div>
        {/* 可用范围与模型元信息同属“这个模型对谁可见”的描述，收进同一行，避免独占一行显得突兀。 */}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span
            className="min-w-0 truncate text-xs text-neutral-400"
            title={model.description ?? undefined}
          >
            {model.modelId} · {model.providerName} · {kindLabel(model)}
          </span>
          {!batchMode && (
            <button
              type="button"
              onClick={onAccess}
              aria-label={`配置 ${model.displayName} 的可用用户，当前${accessLabel}`}
              title="配置可用用户"
              className={clsx(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[11px] leading-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30',
                model.accessMode === 'all'
                  ? 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
                  : model.allowedUserCount > 0
                    ? 'bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/65'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50',
              )}
            >
              <UsersRound className="h-3 w-3 shrink-0" />
              {accessLabel}
            </button>
          )}
        </div>
      </div>

      {!batchMode && (
        <>
          <div className="hidden flex-wrap justify-end gap-1 md:flex">
            {caps.map((k) => (
              <span
                key={k}
                className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              >
                {CAP_BADGE[k]}
              </span>
            ))}
          </div>

          <Toggle
            checked={model.enabled}
            onChange={onToggle}
            disabled={togglePending}
            ariaLabel={`${model.enabled ? '全局停用' : '全局启用'} ${model.displayName}`}
          />

          <div className="flex shrink-0 items-center gap-1">
            <IconButton label={`配置 ${model.displayName}`} onClick={onEdit}>
              <SlidersHorizontal className="h-4 w-4" />
            </IconButton>
            <IconButton label={`删除 ${model.displayName}`} tone="danger" onClick={onDelete}>
              <DeleteIcon className="h-4 w-4" />
            </IconButton>
          </div>
        </>
      )}
    </div>
  )
}

/** 分组视图下的分区标题（分组视图不支持拖拽，标题纯展示）。 */
function GroupHeading({ group, count }: { group: AdminModelGroupDTO | null; count: number }) {
  return (
    <div
      className={clsx(
        'flex items-center border-b border-neutral-100 bg-neutral-50/80 py-2 dark:border-neutral-800 dark:bg-neutral-800/40',
        ROW_INSET_X,
        ROW_GAP_X,
      )}
    >
      {group ? (
        <ModelGroupGlyph group={group} size="md" />
      ) : (
        <span aria-hidden className={ROW_ICON_COLUMN} />
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-500 dark:text-neutral-400">
        {group?.name ?? '未分组'}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">{count}</span>
    </div>
  )
}

export default function ModelsPage() {
  const qc = useQueryClient()
  const { data: models, isLoading } = useQuery({
    queryKey: ['admin', 'models'],
    queryFn: adminApi.listAdminModels,
  })
  const { data: groups } = useQuery({
    queryKey: ['admin', 'model-groups'],
    queryFn: adminApi.listAdminModelGroups,
  })
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorModel, setEditorModel] = useState<AdminModelDTO | null>(null)
  const [accessModel, setAccessModel] = useState<AdminModelDTO | null>(null)
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const [groupView, setGroupView] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)
  const [batchIconOpen, setBatchIconOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const openCreate = () => {
    setAccessModel(null)
    setEditorModel(null)
    setEditorOpen(true)
  }
  const openEdit = (m: AdminModelDTO) => {
    setAccessModel(null)
    setEditorModel(m)
    setEditorOpen(true)
  }
  const openAccess = (m: AdminModelDTO) => {
    setEditorOpen(false)
    setAccessModel(m)
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
      qc.invalidateQueries({ queryKey: ['admin', 'model-groups'] })
      qc.invalidateQueries({ queryKey: ['models'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  const providerOptions = useMemo<SelectOption[]>(() => {
    const seen = new Map<string, string>()
    for (const m of models ?? []) seen.set(m.providerId, m.providerName)
    return [
      { value: '', label: '全部供应商' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ]
  }, [models])

  const keyword = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      (models ?? []).filter(
        (m) =>
          (!providerFilter || m.providerId === providerFilter) &&
          (!keyword ||
            m.displayName.toLowerCase().includes(keyword) ||
            m.modelId.toLowerCase().includes(keyword)),
      ),
    [models, providerFilter, keyword],
  )
  const filterActive = Boolean(keyword || providerFilter)
  // 分组视图按组重排了行的位置，全局拖拽排序在这种呈现下无法可靠映射，与筛选态同样禁用。
  const sortable = !filterActive && !groupView && !batchMode

  /** 分组视图的分区：顺序跟随分组 sort，未分组置尾；空分组也显示（管理员要能看见空组）。 */
  const sections = useMemo(() => {
    const byGroup = new Map<string, AdminModelDTO[]>()
    const ungrouped: AdminModelDTO[] = []
    const known = new Set((groups ?? []).map((g) => g.id))
    for (const model of filtered) {
      if (model.groupId && known.has(model.groupId)) {
        const bucket = byGroup.get(model.groupId)
        if (bucket) bucket.push(model)
        else byGroup.set(model.groupId, [model])
      } else {
        ungrouped.push(model)
      }
    }
    const result: { group: AdminModelGroupDTO | null; models: AdminModelDTO[] }[] = (
      groups ?? []
    ).map((group) => ({ group, models: byGroup.get(group.id) ?? [] }))
    if (ungrouped.length) result.push({ group: null, models: ungrouped })
    return result
  }, [filtered, groups])

  const selectedModels = useMemo(
    () => filtered.filter((m) => selectedIds.has(m.id)),
    [filtered, selectedIds],
  )

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitBatch = () => {
    setBatchMode(false)
    setSelectedIds(new Set())
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!models || !over || active.id === over.id || reorder.isPending) return
    const ids = models.map((m) => m.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    reorder.mutate({ modelIds: arrayMove(ids, oldIndex, newIndex) })
  }

  const renderRow = (m: AdminModelDTO) => (
    <ModelRow
      key={m.id}
      model={m}
      sortable={sortable}
      batchMode={batchMode}
      selected={selectedIds.has(m.id)}
      onToggleSelected={() => toggleSelected(m.id)}
      onEdit={() => openEdit(m)}
      onAccess={() => openAccess(m)}
      onToggle={() => toggleEnabled.mutate(m)}
      togglePending={toggleEnabled.isPending && toggleEnabled.variables?.id === m.id}
      onDelete={() => {
        void askConfirm({
          title: '删除模型？',
          description: `模型「${m.displayName}」将从用户端下架并删除配置，且无法恢复。`,
          confirmLabel: '删除',
          tone: 'danger',
        }).then((ok) => {
          if (ok) remove.mutate(m.id)
        })
      }}
    />
  )

  const listClass = clsx(
    cardSurface,
    'divide-y divide-neutral-100 overflow-hidden dark:divide-neutral-800',
  )

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="模型"
        description="列表开关控制模型全局上下架；可用范围控制启用后哪些账号可以使用。"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> 添加模型
          </Button>
        }
      />

      {/*
        工具栏统一控件高度（h-9）；「分组显示 / 批量管理」用同规格的开关按钮，
        排序提示单独占一行，避免它出现/消失时把搜索框挤窄导致布局跳动。
      */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索名称或模型 ID"
              className="h-9 w-full rounded-lg border border-neutral-300 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-neutral-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-sky-400"
            />
          </div>
          <Select
            className="h-9 !py-0"
            options={providerOptions}
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
          />
          <Button
            variant={groupView ? 'primary' : 'secondary'}
            aria-pressed={groupView}
            className="h-9 !px-3 !py-0 text-xs"
            onClick={() => setGroupView((v) => !v)}
          >
            <FolderTree className="h-3.5 w-3.5" /> 分组显示
          </Button>
          <Button
            variant={batchMode ? 'primary' : 'secondary'}
            aria-pressed={batchMode}
            className="h-9 !px-3 !py-0 text-xs"
            onClick={() => (batchMode ? exitBatch() : setBatchMode(true))}
          >
            <ListChecks className="h-3.5 w-3.5" /> 批量管理
          </Button>
        </div>
        {!sortable && !batchMode && (
          <p className="text-xs text-neutral-400">
            {groupView ? '分组视图下不可拖拽排序' : '筛选中不可拖拽排序'}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : !models?.length ? (
        <EmptyState
          icon={Boxes}
          title="还没有模型，请在「提供商」页同步或挑选，或手动添加。"
          action={
            <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> 添加模型
            </Button>
          }
        />
      ) : !filtered.length ? (
        <EmptyState icon={Search} title="没有匹配筛选条件的模型" />
      ) : groupView ? (
        <div className={listClass}>
          {sections.map((section) => (
            <div key={section.group?.id ?? '__ungrouped__'}>
              <GroupHeading group={section.group} count={section.models.length} />
              {section.models.length === 0 ? (
                <div
                  className={clsx(
                    'flex items-center py-3 text-xs text-neutral-400',
                    ROW_INSET_X,
                    ROW_GAP_X,
                  )}
                >
                  <span aria-hidden className={ROW_ICON_COLUMN} />
                  <span className="min-w-0 flex-1 truncate">
                    该分组下暂无模型，可用「批量管理」把模型移进来
                  </span>
                </div>
              ) : (
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {section.models.map(renderRow)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={filtered.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <div className={listClass}>{filtered.map(renderRow)}</div>
          </SortableContext>
        </DndContext>
      )}

      {batchMode && (
        <ModelBatchToolbar
          selectedCount={selectedModels.length}
          totalCount={filtered.length}
          onSelectAll={() => setSelectedIds(new Set(filtered.map((m) => m.id)))}
          onClear={() => setSelectedIds(new Set())}
          onAssign={() => setAssignOpen(true)}
          onDetectIcons={() => setBatchIconOpen(true)}
          onExit={exitBatch}
        />
      )}

      {editorOpen && <ModelEditor model={editorModel} onClose={() => setEditorOpen(false)} />}
      {accessModel && (
        <ModelAccessDialog model={accessModel} onClose={() => setAccessModel(null)} />
      )}
      {assignOpen && (
        <AssignGroupDialog
          models={selectedModels}
          groups={groups ?? []}
          onClose={() => setAssignOpen(false)}
          onDone={exitBatch}
        />
      )}
      {batchIconOpen && (
        <BatchIconDialog
          models={selectedModels}
          onClose={() => setBatchIconOpen(false)}
          onDone={exitBatch}
        />
      )}
    </div>
  )
}
