import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { ChevronDown, GripVertical, Infinity as InfinityIcon, Plus, Trash2 } from 'lucide-react'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import { QuotaRuleEditor } from './QuotaRuleEditor'
import {
  QUOTA_RULE_LIMIT,
  countQuotaRulePriorityTiers,
  createQuotaRuleDraft,
  moveQuotaRuleDraft,
  summarizeQuotaRuleDraft,
  type QuotaRuleDraft,
} from './quotaRuleDrafts'

function RuleRow({
  draft,
  expanded,
  sortable,
  autoFocus,
  models,
  groups,
  invalidMessage,
  onToggle,
  onChange,
  onRemove,
}: {
  draft: QuotaRuleDraft
  expanded: boolean
  sortable: boolean
  autoFocus: boolean
  models: AdminModelDTO[]
  groups: AdminModelGroupDTO[]
  invalidMessage?: string
  onToggle: () => void
  onChange: (next: QuotaRuleDraft) => void
  onRemove: () => void
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
  const rowName = summary.title
  const panelId = `quota-rule-panel-${draft.id}`

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'bg-white dark:bg-neutral-900',
        isDragging &&
          'relative z-10 rounded-lg shadow-lg ring-1 ring-neutral-200 dark:shadow-black/40 dark:ring-neutral-700',
        !isDragging && expanded && 'bg-neutral-50/70 dark:bg-neutral-800/25',
        invalidMessage && !isDragging && 'bg-amber-50/50 dark:bg-amber-400/[0.04]',
      )}
    >
      <div className="flex items-start gap-0.5 py-2 pl-1 pr-1.5">
        {sortable ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`拖动调整「${rowName}」的展示顺序`}
            className="mt-0.5 flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-neutral-300 transition hover:bg-neutral-100 hover:text-neutral-500 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-400"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : (
          <span className="w-1.5 shrink-0" />
        )}

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1.5 py-0.5 text-left transition hover:bg-neutral-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:hover:bg-neutral-800/70"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                {rowName}
              </span>
              {summary.priority != null && (
                <span className="shrink-0 rounded-md bg-sky-50 px-1.5 py-px text-[10px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                  优先 {summary.priority}
                </span>
              )}
              {summary.incomplete && (
                <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                  待完善
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
              {summary.subtitle}
            </span>
          </span>
          <span
            className={clsx(
              'mt-1 shrink-0 text-xs tabular-nums',
              summary.unlimited
                ? 'font-medium text-violet-600 dark:text-violet-300'
                : summary.incomplete
                  ? 'text-neutral-400 dark:text-neutral-500'
                  : 'font-medium text-neutral-700 dark:text-neutral-200',
            )}
          >
            {summary.limitText}
            {summary.windowText ? (
              <span className="font-normal text-neutral-400 dark:text-neutral-500">
                {' '}
                · {summary.windowText}
              </span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={clsx(
              'mt-1.5 h-4 w-4 shrink-0 text-neutral-300 transition-transform dark:text-neutral-600',
              expanded && 'rotate-180',
            )}
          />
        </button>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`删除「${rowName}」`}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-300 transition hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:text-neutral-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <div
          id={panelId}
          className="border-t border-neutral-100 px-3 pb-3 pt-3 sm:px-3.5 dark:border-neutral-800"
        >
          <QuotaRuleEditor
            draft={draft}
            models={models}
            groups={groups}
            onChange={onChange}
            invalidMessage={invalidMessage}
            autoFocus={autoFocus}
          />
        </div>
      )}
    </div>
  )
}

interface Props {
  title: string
  description: ReactNode
  emptyMessage: ReactNode
  addLabel?: string
  drafts: QuotaRuleDraft[]
  onChange: (drafts: QuotaRuleDraft[]) => void
  models: AdminModelDTO[]
  groups: AdminModelGroupDTO[]
  invalidIndex?: number | null
  invalidMessage?: string
  /** 空列表是否用 ∞ 暗示「零规则 = 无限额度」；用户专属规则应关掉。 */
  emptyUnlimited?: boolean
}

/**
 * 策略 / 用户专属规则共用的限额规则列表。
 *
 * 多条时默认折叠，方便扫读与拖拽；点开一行再编辑。
 * 展示顺序随拖拽写入规则数组，覆盖关系仍只看 `priority`——
 * 同档规则是「同时生效」，不能把列表顺序误当成防火墙式先到先得。
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
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(() => {
    if (invalidIndex != null && drafts[invalidIndex]) return drafts[invalidIndex]!.id
    return drafts.length === 1 ? drafts[0]!.id : null
  })
  const [focusId, setFocusId] = useState<string | null>(null)
  const idsKey = drafts.map((draft) => draft.id).join('\0')
  const idsKeyRef = useRef(idsKey)
  if (idsKey !== idsKeyRef.current) {
    const previous = new Set(idsKeyRef.current.split('\0').filter(Boolean))
    const added = drafts.find((draft) => !previous.has(draft.id))
    idsKeyRef.current = idsKey
    if (added) {
      setExpandedId(added.id)
      setFocusId(added.id)
    } else if (expandedId && !drafts.some((draft) => draft.id === expandedId)) {
      setExpandedId(drafts.length === 1 ? drafts[0]!.id : null)
    }
  }

  const invalidId = invalidIndex != null ? drafts[invalidIndex]?.id : undefined
  const invalidIdRef = useRef<string | undefined>(undefined)
  if (invalidId && invalidId !== invalidIdRef.current) {
    invalidIdRef.current = invalidId
    if (expandedId !== invalidId) setExpandedId(invalidId)
  }
  if (!invalidId) invalidIdRef.current = undefined

  // 只在新加的那一行首次展开时自动聚焦备注框；清掉之后再展开不会抢走焦点。
  useEffect(() => {
    if (!focusId) return
    const timer = window.setTimeout(() => setFocusId(null), 0)
    return () => window.clearTimeout(timer)
  }, [focusId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const sortable = drafts.length > 1
  const atLimit = drafts.length >= QUOTA_RULE_LIMIT
  const priorityTiers = countQuotaRulePriorityTiers(drafts)

  const addRule = () => {
    if (atLimit) return
    onChange([...drafts, createQuotaRuleDraft()])
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onChange(moveQuotaRuleDraft(drafts, String(active.id), String(over.id)))
  }

  return (
    <div>
      <div className="mb-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{title}</h3>
          {drafts.length > 0 && (
            <span className="text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
              {drafts.length} / {QUOTA_RULE_LIMIT}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
          {description}
        </p>
        {priorityTiers > 1 && (
          <p className="mt-1.5 rounded-lg bg-sky-50 px-2.5 py-1.5 text-[11px] leading-5 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200">
            当前有 {priorityTiers} 个优先档。数字更大的规则会接管重叠模型，同档则同时生效。
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700">
        {drafts.length === 0 ? (
          <div className="flex items-start gap-2.5 px-3.5 py-5 text-sm text-neutral-500 dark:text-neutral-400">
            {emptyUnlimited && (
              <InfinityIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
            )}
            <div className="min-w-0 leading-6">{emptyMessage}</div>
          </div>
        ) : (
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
              <div role="list" className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {drafts.map((draft, index) => (
                  <div key={draft.id} role="listitem">
                    <RuleRow
                      draft={draft}
                      expanded={expandedId === draft.id}
                      sortable={sortable}
                      autoFocus={focusId === draft.id}
                      models={models}
                      groups={groups}
                      invalidMessage={invalidIndex === index ? invalidMessage : undefined}
                      onToggle={() =>
                        setExpandedId((current) => (current === draft.id ? null : draft.id))
                      }
                      onChange={(next) =>
                        onChange(drafts.map((item) => (item.id === draft.id ? next : item)))
                      }
                      onRemove={() => onChange(drafts.filter((item) => item.id !== draft.id))}
                    />
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        <button
          type="button"
          onClick={addRule}
          disabled={atLimit}
          className="flex w-full items-center justify-center gap-1.5 border-t border-neutral-100 px-3 py-2.5 text-xs text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {atLimit ? `最多 ${QUOTA_RULE_LIMIT} 条规则` : addLabel}
        </button>
      </div>
    </div>
  )
}
