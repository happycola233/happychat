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
import { GripVertical, Pin, Plus, Trash2 } from 'lucide-react'
import {
  createReasoningEffortDraft,
  getReasoningEffortDraftErrors,
  type ReasoningEffortDraft,
  type ReasoningEffortDraftFieldErrors,
  validateReasoningEffortDrafts,
} from './reasoningEffortDrafts'

/**
 * 幽灵输入框：静止时无边框融入行内，悬停浮现淡描边、聚焦才显示完整输入态。
 * 让每一行读起来是「一条等级」，而不是一排嵌套的表单控件。
 */
const ghostInputClass =
  'rounded-lg border border-transparent bg-transparent px-2.5 py-1.5 outline-none transition placeholder:text-neutral-400 hover:border-neutral-200 focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-500/15 dark:text-neutral-100 dark:hover:border-neutral-700 dark:focus:border-sky-400 dark:focus:bg-neutral-900'
const ghostInputErrorClass =
  'border-red-300 hover:border-red-400 focus:border-red-500 focus:ring-red-500/10 dark:border-red-500/70 dark:focus:border-red-400'

interface Props {
  drafts: ReasoningEffortDraft[]
  defaultDraftId: string | null
  onDraftsChange: (drafts: ReasoningEffortDraft[]) => void
  onDefaultDraftIdChange: (draftId: string | null) => void
}

/** 单行等级：拖拽手柄 + 上游值 + 显示描述 + 行内「默认」标记 + 删除。 */
function EffortRow({
  draft,
  errors,
  isDefault,
  onChange,
  onToggleDefault,
  onRemove,
}: {
  draft: ReasoningEffortDraft
  errors: ReasoningEffortDraftFieldErrors | undefined
  isDefault: boolean
  onChange: (field: 'value' | 'description', value: string) => void
  onToggleDefault: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: draft.draftId })
  const rowName = draft.description.trim() || draft.value.trim() || '未命名等级'
  const valueErrorId = `${draft.draftId}-value-error`
  const descriptionErrorId = `${draft.draftId}-description-error`

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'bg-white dark:bg-neutral-900',
        isDragging &&
          'relative z-10 rounded-lg shadow-lg ring-1 ring-neutral-200 dark:shadow-black/40 dark:ring-neutral-700',
      )}
    >
      <div className="flex items-center gap-1 py-1 pl-1 pr-1.5">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`拖动排序 ${rowName}`}
          className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-neutral-300 transition hover:text-neutral-500 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-600 dark:hover:text-neutral-400"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <input
          className={clsx(
            ghostInputClass,
            'w-28 shrink-0 font-mono text-xs sm:w-32',
            errors?.value && ghostInputErrorClass,
          )}
          value={draft.value}
          onChange={(event) => onChange('value', event.target.value)}
          placeholder="上游值"
          spellCheck={false}
          autoCapitalize="none"
          aria-label="上游值"
          aria-invalid={errors?.value ? true : undefined}
          aria-describedby={errors?.value ? valueErrorId : undefined}
        />
        <input
          className={clsx(
            ghostInputClass,
            'min-w-0 flex-1 text-sm',
            errors?.description && ghostInputErrorClass,
          )}
          value={draft.description}
          onChange={(event) => onChange('description', event.target.value)}
          placeholder="显示描述"
          aria-label="显示描述"
          aria-invalid={errors?.description ? true : undefined}
          aria-describedby={errors?.description ? descriptionErrorId : undefined}
        />
        <button
          type="button"
          onClick={onToggleDefault}
          aria-pressed={isDefault}
          title={isDefault ? '已是默认思考等级，点击取消' : `将「${rowName}」设为默认思考等级`}
          className={clsx(
            'flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
            isDefault
              ? 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300'
              : 'text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
          )}
        >
          <Pin aria-hidden className={clsx('h-3 w-3', isDefault && 'fill-current')} />
          {isDefault ? '默认' : '设默认'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`删除 ${rowName}`}
          title={`删除 ${rowName}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-300 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:text-neutral-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {(errors?.value || errors?.description) && (
        <div className="space-y-0.5 pb-1.5 pl-8 text-[11px] leading-4 text-red-600 dark:text-red-400">
          {errors.value && <p id={valueErrorId}>{errors.value}</p>}
          {errors.description && <p id={descriptionErrorId}>{errors.description}</p>}
        </div>
      )}
    </div>
  )
}

/** 自定义推理等级：单一容器的行内编辑列表，拖拽排序（顺序原样用于聊天端），默认档位在行内标记。 */
export function ReasoningEffortEditor({
  drafts,
  defaultDraftId,
  onDraftsChange,
  onDefaultDraftIdChange,
}: Props) {
  const fieldErrors = getReasoningEffortDraftErrors(drafts)
  const validationError = validateReasoningEffortDrafts(drafts)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const updateDraft = (draftId: string, field: 'value' | 'description', value: string) => {
    onDraftsChange(
      drafts.map((draft) => (draft.draftId === draftId ? { ...draft, [field]: value } : draft)),
    )
  }

  const removeDraft = (draftId: string) => {
    onDraftsChange(drafts.filter((draft) => draft.draftId !== draftId))
    if (defaultDraftId === draftId) onDefaultDraftIdChange(null)
  }

  const addDraft = () => {
    if (drafts.length >= 16) return
    onDraftsChange([...drafts, createReasoningEffortDraft()])
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = drafts.map((draft) => draft.draftId)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onDraftsChange(arrayMove(drafts, oldIndex, newIndex))
  }

  return (
    <div>
      <div className="text-sm font-medium text-neutral-700 dark:text-neutral-200">思考等级</div>
      <p className="mt-0.5 text-xs leading-5 text-neutral-400 dark:text-neutral-500">
        上游值原样写入 reasoning.effort，描述仅用于界面；拖动排序即聊天选择器顺序，「默认」为新会话初始档位。
      </p>

      <div className="mt-2 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700">
        {drafts.length === 0 ? (
          <div className="px-3 py-5 text-center text-xs text-neutral-400">尚未配置推理等级</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={drafts.map((draft) => draft.draftId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {drafts.map((draft) => (
                  <EffortRow
                    key={draft.draftId}
                    draft={draft}
                    errors={fieldErrors[draft.draftId]}
                    isDefault={defaultDraftId === draft.draftId}
                    onChange={(field, value) => updateDraft(draft.draftId, field, value)}
                    onToggleDefault={() =>
                      onDefaultDraftIdChange(
                        defaultDraftId === draft.draftId ? null : draft.draftId,
                      )
                    }
                    onRemove={() => removeDraft(draft.draftId)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        <button
          type="button"
          onClick={addDraft}
          disabled={drafts.length >= 16}
          className="flex w-full items-center justify-center gap-1.5 border-t border-neutral-100 px-3 py-2 text-xs text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 disabled:opacity-40 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          添加等级
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        {validationError ? (
          <p role="alert" className="text-xs leading-5 text-red-600 dark:text-red-400">
            {validationError}
          </p>
        ) : (
          <span />
        )}
        {defaultDraftId === null && drafts.length > 0 && (
          <span className="text-[11px] text-neutral-400">未设默认时新会话沿用上游默认档位</span>
        )}
      </div>
    </div>
  )
}
