import { useRef, useState, type ReactNode } from 'react'
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { clsx } from 'clsx'
import { Copy, GripVertical, Infinity as InfinityIcon, Plus, Trash2 } from 'lucide-react'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import { IconButton } from '../../components/ui/IconButton'
import { QuotaRuleEditor } from './QuotaRuleEditor'
import {
  QUOTA_RULE_LIMIT,
  createQuotaRuleDraft,
  duplicateQuotaRuleDraft,
  moveQuotaRuleDraft,
  summarizeQuotaRuleDraft,
  type QuotaRuleDraft,
} from './quotaRuleDrafts'

function RuleRow({
  draft,
  selected,
  sortable,
  invalid,
  onSelect,
}: {
  draft: QuotaRuleDraft
  selected: boolean
  sortable: boolean
  invalid: boolean
  onSelect: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: draft.id, disabled: !sortable })
  const summary = summarizeQuotaRuleDraft(draft)

  return (
    <div
      ref={setNodeRef}
      role="listitem"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'group flex items-stretch rounded-lg transition',
        selected
          ? 'bg-sky-50 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:ring-sky-500/30'
          : 'hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60',
        isDragging &&
          'relative z-10 bg-white shadow-lg ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-700',
      )}
    >
      {sortable && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`拖动调整「${summary.title}」的展示顺序`}
          className="flex w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-l-lg text-neutral-300 opacity-60 transition hover:text-neutral-500 group-hover:opacity-100 active:cursor-grabbing focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-600 dark:hover:text-neutral-400"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={clsx(
          'min-w-0 flex-1 rounded-lg py-2 pr-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
          sortable ? 'pl-0.5' : 'pl-2.5',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {invalid && (
            <span aria-label="有问题" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
            {summary.title}
          </span>
          <span
            className={clsx(
              'shrink-0 text-xs tabular-nums',
              summary.unlimited
                ? 'font-medium text-violet-600 dark:text-violet-300'
                : summary.incomplete
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'font-medium text-neutral-700 dark:text-neutral-200',
            )}
          >
            {summary.limitText}
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className="min-w-0 flex-1 truncate">
            {[summary.subtitle, summary.windowText].filter(Boolean).join(' · ') || ' '}
          </span>
          {summary.priority != null && (
            <span className="shrink-0 rounded bg-sky-100/80 px-1 text-[10px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
              优先 {summary.priority}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}

interface Props {
  title: string
  /** 规则列表上方的一句说明；没有可省略 */
  description?: ReactNode
  emptyMessage: ReactNode
  addLabel?: string
  drafts: QuotaRuleDraft[]
  onChange: (drafts: QuotaRuleDraft[]) => void
  models: AdminModelDTO[]
  groups: AdminModelGroupDTO[]
  invalidIndex?: number | null
  invalidMessage?: string
  /** 空列表是否用 ∞ 暗示「零规则 = 不限额」；用户专属规则应关掉。 */
  emptyUnlimited?: boolean
  /**
   * 占满父级剩余高度（父级需是 lg 起的 flex 列）：宽屏下左侧列表与右侧编辑区各自滚动，
   * 窄屏仍随页面整体滚动。
   */
  fill?: boolean
}

/** 两栏布局：独立页面按容器宽度切换；占满工作台时按视口切换，与外层的固定高度同一断点。 */
const LAYOUT = {
  flow: {
    section: '@container/rules',
    grid: 'grid gap-3 @min-[44rem]/rules:grid-cols-[15rem_minmax(0,1fr)] @min-[44rem]/rules:items-start',
    list: '@min-[44rem]/rules:sticky @min-[44rem]/rules:top-0',
    editor: '',
  },
  fill: {
    section: 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col',
    grid: 'grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]',
    list: 'hc-scrollbar lg:overflow-y-auto',
    editor: 'hc-scrollbar lg:overflow-y-auto',
  },
} as const

/**
 * 策略 / 用户专属规则共用的规则编辑区：左侧规则列表，右侧编辑选中的规则；空间较窄时上下排列。
 *
 * 列表顺序随拖拽写入规则数组，只影响展示；生效关系只看 `priority`——
 * 同档规则同时生效，不能把列表顺序误当成先到先得。
 */
export function QuotaRuleList({
  title,
  description,
  emptyMessage,
  addLabel = '添加规则',
  drafts,
  onChange,
  models,
  groups,
  invalidIndex = null,
  invalidMessage,
  emptyUnlimited = false,
  fill = false,
}: Props) {
  const layout = LAYOUT[fill ? 'fill' : 'flow']
  const [selectedId, setSelectedId] = useState<string | null>(drafts[0]?.id ?? null)
  const [focusId, setFocusId] = useState<string | null>(null)
  // 保存失败时跳到出错的规则；同一条错误只跳一次，不妨碍管理员之后切到别的规则。
  const invalidId = invalidIndex != null ? drafts[invalidIndex]?.id : undefined
  const shownInvalidRef = useRef<string | undefined>(undefined)
  if (invalidId !== shownInvalidRef.current) {
    shownInvalidRef.current = invalidId
    if (invalidId && selectedId !== invalidId) setSelectedId(invalidId)
  }
  const selected = drafts.find((draft) => draft.id === selectedId) ?? drafts[0] ?? null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const atLimit = drafts.length >= QUOTA_RULE_LIMIT

  const insert = (draft: QuotaRuleDraft, afterId?: string) => {
    if (atLimit) return
    const index = afterId ? drafts.findIndex((item) => item.id === afterId) + 1 : drafts.length
    onChange([...drafts.slice(0, index), draft, ...drafts.slice(index)])
    setSelectedId(draft.id)
    setFocusId(draft.id)
  }
  const remove = (id: string) => {
    const index = drafts.findIndex((draft) => draft.id === id)
    const next = drafts.filter((draft) => draft.id !== id)
    onChange(next)
    setSelectedId(next[Math.min(index, next.length - 1)]?.id ?? null)
  }
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onChange(moveQuotaRuleDraft(drafts, String(active.id), String(over.id)))
  }

  return (
    <section className={layout.section}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
            {title}
            {drafts.length > 0 && (
              <span className="ml-1.5 text-xs font-normal tabular-nums text-neutral-400">
                {drafts.length} / {QUOTA_RULE_LIMIT}
              </span>
            )}
          </h3>
          {description && (
            <p className="mt-0.5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => insert(createQuotaRuleDraft())}
          disabled={atLimit}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-sky-300 dark:hover:bg-sky-500/10"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {atLimit ? `最多 ${QUOTA_RULE_LIMIT} 条` : addLabel}
        </button>
      </div>

      {drafts.length === 0 || !selected ? (
        <button
          type="button"
          onClick={() => insert(createQuotaRuleDraft())}
          className="flex w-full items-start gap-2.5 rounded-xl border border-dashed border-neutral-300 px-4 py-5 text-left text-sm text-neutral-500 transition hover:border-sky-300 hover:bg-sky-50/40 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/5"
        >
          {emptyUnlimited && <InfinityIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />}
          <span className="min-w-0 leading-6">{emptyMessage}</span>
        </button>
      ) : (
        <div className={layout.grid}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={drafts.map((draft) => draft.id)}
              strategy={verticalListSortingStrategy}
            >
              {/* 拖拽行直接属于列表，父元素边界限制才会覆盖整个列表，而非锁在单行内。 */}
              <div
                role="list"
                aria-label={title}
                className={clsx(
                  'space-y-1 self-start rounded-xl bg-neutral-50 p-1 dark:bg-neutral-800/40',
                  fill && 'lg:max-h-full',
                  layout.list,
                )}
              >
                {drafts.map((draft, index) => (
                  <RuleRow
                    key={draft.id}
                    draft={draft}
                    selected={draft.id === selected.id}
                    sortable={drafts.length > 1}
                    invalid={invalidIndex === index}
                    onSelect={() => setSelectedId(draft.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <div
            className={clsx(
              'min-w-0 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800',
              layout.editor,
            )}
          >
            <div className="-mt-1 mb-3 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-medium text-neutral-500 dark:text-neutral-400">
                第 {drafts.findIndex((draft) => draft.id === selected.id) + 1} 条规则
              </span>
              <div className="flex shrink-0 items-center gap-0.5">
                <IconButton
                  label="复制这条规则"
                  disabled={atLimit}
                  onClick={() => insert(duplicateQuotaRuleDraft(selected), selected.id)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label="删除这条规则" tone="danger" onClick={() => remove(selected.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </div>
            <QuotaRuleEditor
              key={selected.id}
              draft={selected}
              models={models}
              groups={groups}
              onChange={(next) =>
                onChange(drafts.map((item) => (item.id === selected.id ? next : item)))
              }
              invalidMessage={selected.id === invalidId ? invalidMessage : undefined}
              autoFocus={focusId === selected.id}
            />
          </div>
        </div>
      )}
    </section>
  )
}
