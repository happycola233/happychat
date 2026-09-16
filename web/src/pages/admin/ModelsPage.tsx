import { ModelListHeader, ModelListRow } from './ModelListRow'
import { LoadError } from '../../components/ui/LoadError'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { clsx } from 'clsx'
import { Boxes, Layers3, ListChecks, Plus, Search } from 'lucide-react'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import * as adminApi from '../../api/admin'
import { ModelGroupGlyph } from '../../components/ModelIcon'
import { Button } from '../../components/ui/Button'
import { cardSurface } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
import { Select, type SelectOption } from '../../components/ui/Select'
import { SearchField } from '../../components/ui/SearchField'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { Spinner } from '../../components/ui/Spinner'
import { askConfirm } from '../../store/confirm'
import { toast } from '../../store/toast'
import { ModelAccessDialog } from './ModelAccessDialog'
import { ModelEditor, type ModelEditorSection } from './ModelEditor'
import { AssignGroupDialog, BatchIconDialog, ModelBatchToolbar } from './ModelBatchTools'

const ROW_INSET_X = 'px-2 sm:px-3'
const ROW_GAP_X = 'gap-2 sm:gap-3'
const ROW_ICON_COLUMN = 'h-5 w-5 shrink-0'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    data: models,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'models'],
    queryFn: adminApi.listAdminModels,
  })
  const { data: groups } = useQuery({
    queryKey: ['admin', 'model-groups'],
    queryFn: adminApi.listAdminModelGroups,
  })
  const { data: providers } = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: adminApi.listProviders,
  })
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorSearch, setEditorSearch] = useState('')
  const [editorModel, setEditorModel] = useState<AdminModelDTO | null>(null)
  const [editorSection, setEditorSection] = useState<ModelEditorSection>('general')
  const [accessModel, setAccessModel] = useState<AdminModelDTO | null>(null)
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState(searchParams.get('providerId') ?? '')
  const [groupFilter, setGroupFilter] = useState(searchParams.get('groupId') ?? '')
  const [statusFilter, setStatusFilter] = useState('all')
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
    setEditorSection('general')
    setEditorOpen(true)
  }
  const openEdit = (m: AdminModelDTO, section: ModelEditorSection = 'general') => {
    setAccessModel(null)
    setEditorModel(m)
    setEditorSection(section)
    setEditorOpen(true)
  }
  useEffect(() => {
    const id = searchParams.get('edit')
    const target = models?.find((model) => model.id === id)
    if (!target) return
    setEditorModel(target)
    setEditorSection('general')
    setEditorOpen(true)
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('edit')
        return next
      },
      { replace: true },
    )
  }, [models, searchParams, setSearchParams])
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

  const duplicate = useMutation({
    mutationFn: adminApi.duplicateModel,
    onSuccess: (copiedModel) => {
      toast.success(`已创建「${copiedModel.displayName}」`)
      invalidate()
      qc.invalidateQueries({ queryKey: ['admin', 'providers'] })
      qc.invalidateQueries({ queryKey: ['admin', 'model-groups'] })
      qc.invalidateQueries({ queryKey: ['models'] })
      openEdit(copiedModel)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '复制失败'),
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
    for (const provider of providers ?? []) seen.set(provider.id, provider.name)
    for (const m of models ?? []) seen.set(m.providerId, m.providerName)
    return [
      { value: '', label: '全部供应商' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ]
  }, [models, providers])

  const keyword = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      (models ?? []).filter(
        (m) =>
          (!providerFilter || m.providerId === providerFilter) &&
          (!groupFilter ||
            (groupFilter === 'ungrouped' ? !m.groupId : m.groupId === groupFilter)) &&
          (statusFilter === 'all' || m.enabled === (statusFilter === 'enabled')) &&
          (!keyword ||
            m.displayName.toLowerCase().includes(keyword) ||
            m.modelId.toLowerCase().includes(keyword)),
      ),
    [models, providerFilter, groupFilter, statusFilter, keyword],
  )
  const filterActive = Boolean(keyword || providerFilter || groupFilter || statusFilter !== 'all')
  const resetFilters = () => {
    setSearch('')
    setProviderFilter('')
    setGroupFilter('')
    setStatusFilter('all')
  }
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
    <ModelListRow
      key={m.id}
      model={m}
      sortable={sortable}
      batchMode={batchMode}
      selected={selectedIds.has(m.id)}
      onToggleSelected={() => toggleSelected(m.id)}
      onEdit={(section) => openEdit(m, section)}
      onDuplicate={() => duplicate.mutate(m.id)}
      duplicatePending={duplicate.isPending && duplicate.variables === m.id}
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
    <div className="mx-auto w-full space-y-4">
      <PageHeader
        title="模型"
        description="比较模型能力、价格与权限，点击名称或价格即可编辑。"
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
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="搜索名称或模型 ID"
            className="min-w-48 flex-1"
          />
          <Select
            aria-label="筛选供应商"
            options={providerOptions}
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
          />
          <Select
            aria-label="筛选分组"
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
            options={[
              { value: '', label: '全部分组' },
              { value: 'ungrouped', label: '未分组' },
              ...(groups ?? []).map((group) => ({ value: group.id, label: group.name })),
            ]}
          />
          <Button
            variant={groupView ? 'primary' : 'secondary'}
            aria-pressed={groupView}
            className="h-9 !px-3 !py-0 text-xs"
            onClick={() => setGroupView((v) => !v)}
          >
            <Layers3 className="h-3.5 w-3.5" /> 分组显示
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl
            label="模型状态"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: '全部', count: models?.length ?? 0 },
              {
                value: 'enabled',
                label: '已启用',
                count: models?.filter((model) => model.enabled).length ?? 0,
              },
              {
                value: 'disabled',
                label: '已停用',
                count: models?.filter((model) => !model.enabled).length ?? 0,
              },
            ]}
          />
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <span>显示 {filtered.length} 个模型</span>
            {filterActive && (
              <Button size="sm" variant="ghost" onClick={resetFilters}>
                清除筛选
              </Button>
            )}
          </div>
        </div>
      </div>

      {isError && <LoadError hasData={Boolean(models)} onRetry={() => void refetch()} />}
      {isError && !models ? null : isLoading ? (
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
        <EmptyState
          icon={Search}
          title="没有匹配筛选条件的模型"
          action={
            <Button variant="secondary" onClick={resetFilters}>
              清除筛选
            </Button>
          }
        />
      ) : groupView ? (
        <div className={listClass}>
          {sections.map((section) => (
            <div key={section.group?.id ?? '__ungrouped__'}>
              <GroupHeading group={section.group} count={section.models.length} />
              {section.models.length > 0 && <ModelListHeader />}
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
            <div className={listClass}>
              <ModelListHeader />
              {filtered.map(renderRow)}
            </div>
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

      {editorOpen && (
        <ModelEditor
          key={editorModel?.id ?? 'new'}
          model={editorModel}
          models={models ?? []}
          modelSearch={editorSearch}
          onModelSearch={setEditorSearch}
          onSelectModel={(next, section) => {
            setEditorModel(next)
            setEditorSection(section)
          }}
          initialSection={editorSection}
          onClose={() => setEditorOpen(false)}
        />
      )}
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
