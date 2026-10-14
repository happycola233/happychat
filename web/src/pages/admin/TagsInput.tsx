import { useId, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { modelTagsSchema } from '@shared/schemas/model-config'
import { MODEL_TAG_MAX_COUNT, MODEL_TAG_MAX_LABEL_LENGTH } from '@shared/util/modelTags'
import { ModelTagBadge } from '../../components/ModelTags'
import { Field } from './FormField'
import { ModelTagEditor } from './ModelTagEditor'
import { createModelTagDraft, type ModelTagDraft } from './modelTagDrafts'

/** 标签宽度不一，鼠标/触摸以指针落点命中目标，避免长标签挤到相邻短标签的位置。 */
const tagCollisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)

function SortableTag({
  tag,
  editorOpen,
  onEdit,
  onRemove,
}: {
  tag: ModelTagDraft
  editorOpen: boolean
  onEdit: (trigger: HTMLButtonElement) => void
  onRemove: () => void
}) {
  const tagName = tag.label.trim() || '未命名标签'
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tag.draftId, data: { label: tagName } })

  return (
    <span
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={clsx(
        'group/tag inline-flex h-7 max-w-full items-center gap-0.5 rounded-lg pl-1 pr-0.5 motion-reduce:!transition-none',
        isDragging &&
          'relative z-10 bg-white shadow-md ring-1 ring-sky-300 dark:bg-neutral-800 dark:ring-sky-600',
        editorOpen
          ? 'bg-sky-50 dark:bg-sky-500/15'
          : 'hover:bg-neutral-100 dark:hover:bg-neutral-700/60',
      )}
      onKeyDownCapture={(event) => {
        // 保留事件传给 dnd-kit 取消拖动，同时让外层弹窗跳过这次 Escape。
        if (isDragging && event.key === 'Escape') event.preventDefault()
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        onClick={(event) => onEdit(event.currentTarget)}
        aria-label={`编辑标签 ${tagName}`}
        aria-roledescription="可排序标签"
        aria-expanded={editorOpen}
        title="点击编辑，拖动排序"
        className="flex h-7 min-w-0 cursor-grab touch-none items-center rounded select-none transition active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        <ModelTagBadge tag={{ ...tag, label: tagName }} className="!max-w-none !text-xs" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`删除标签 ${tagName}`}
        className="flex h-6 w-5 shrink-0 items-center justify-center rounded-full text-neutral-400 opacity-60 transition hover:bg-neutral-200 hover:text-neutral-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 group-hover/tag:opacity-100 dark:hover:bg-neutral-600 dark:hover:text-neutral-100"
      >
        <X aria-hidden className="h-3 w-3" />
      </button>
    </span>
  )
}

/** 标签与颜色随模型草稿一起保存；稳定 draftId 保证改名、重排不丢失当前编辑项。 */
export function TagsInput({
  label = '标签（可选）',
  tags,
  onChange,
  placeholder,
}: {
  label?: string
  tags: ModelTagDraft[]
  onChange: (tags: ModelTagDraft[]) => void
  placeholder?: string
}) {
  const inputId = useId()
  const descriptionId = `${inputId}-description`
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const activeTagIndex = tags.findIndex((tag) => tag.draftId === activeDraftId)
  const activeTag = tags[activeTagIndex]
  const validation = modelTagsSchema.safeParse(tags)
  const activeTagError = validation.success
    ? undefined
    : validation.error.issues.find(
        (issue) => tags[Number(issue.path[0])]?.label.trim() === activeTag?.label.trim(),
      )?.message
  const sensors = useSensors(
    // 轻微位移仍视为点击；超过阈值后由 dnd-kit 阻止拖动结束触发编辑。
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  )

  const addTags = () => {
    // 支持一次粘贴多个（逗号/顿号分隔），统一去空白、去重、限量限长。
    const candidates = newLabel
      .split(/[,，、]/)
      .map((candidate) => candidate.trim())
      .filter(Boolean)
    const next = [...tags]
    for (const candidate of candidates) {
      if (next.length >= MODEL_TAG_MAX_COUNT) break
      if (
        candidate.length > MODEL_TAG_MAX_LABEL_LENGTH ||
        next.some((tag) => tag.label.trim() === candidate)
      )
        continue
      next.push(createModelTagDraft({ label: candidate, color: null }))
    }
    if (next.length !== tags.length) onChange(next)
    setNewLabel('')
  }

  const removeTag = (draftId: string) => {
    onChange(tags.filter((tag) => tag.draftId !== draftId))
    if (activeDraftId === draftId) setActiveDraftId(null)
  }

  const closeEditor = () => {
    setActiveDraftId(null)
    editorTriggerRef.current?.focus()
  }

  const reorderTags = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = tags.findIndex((tag) => tag.draftId === active.id)
    const newIndex = tags.findIndex((tag) => tag.draftId === over.id)
    onChange(arrayMove(tags, oldIndex, newIndex))
  }

  return (
    <Field label={label} htmlFor={inputId}>
      <DndContext
        sensors={sensors}
        collisionDetection={tagCollisionDetection}
        modifiers={[restrictToParentElement]}
        autoScroll={false}
        onDragEnd={reorderTags}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              '按回车键编辑标签。按空格键开始移动，使用方向键调整位置，按空格或回车键完成，按 Escape 取消。',
          },
          announcements: {
            onDragStart: ({ active }) => `开始移动标签「${active.data.current?.label}」。`,
            onDragOver: ({ over }) =>
              over
                ? `移到第 ${over.data.current?.sortable.index + 1} 个位置。`
                : '已移出标签列表。',
            onDragEnd: ({ active, over }) =>
              over
                ? `标签「${active.data.current?.label}」已移到第 ${over.data.current?.sortable.index + 1} 个位置。`
                : '标签顺序未改变。',
            onDragCancel: () => '已取消移动，标签顺序未改变。',
          },
        }}
      >
        <SortableContext items={tags.map((tag) => tag.draftId)} strategy={rectSortingStrategy}>
          <div className="flex min-h-11 w-full flex-wrap content-center items-center gap-x-1 gap-y-1 rounded-xl border border-neutral-300 bg-white px-2 py-1.5 transition focus-within:border-sky-500 focus-within:ring-sky-500/15 focus-within:ring-2 dark:border-neutral-700 dark:bg-neutral-800 dark:focus-within:border-sky-400">
            {tags.map((tag) => (
              <SortableTag
                key={tag.draftId}
                tag={tag}
                editorOpen={activeDraftId === tag.draftId}
                onEdit={(trigger) => {
                  editorTriggerRef.current = trigger
                  setActiveDraftId(activeDraftId === tag.draftId ? null : tag.draftId)
                }}
                onRemove={() => removeTag(tag.draftId)}
              />
            ))}
            <input
              id={inputId}
              aria-describedby={descriptionId}
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              onKeyDown={(event) => {
                // 中文输入法确认候选词时不提交，也不把退格误当作删除标签。
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                if (['Enter', ',', '，', '、'].includes(event.key)) {
                  event.preventDefault()
                  addTags()
                } else if (event.key === 'Backspace' && newLabel === '' && tags.length > 0) {
                  removeTag(tags[tags.length - 1]!.draftId)
                }
              }}
              onBlur={addTags}
              disabled={tags.length >= MODEL_TAG_MAX_COUNT && newLabel === ''}
              placeholder={
                tags.length >= MODEL_TAG_MAX_COUNT
                  ? `最多 ${MODEL_TAG_MAX_COUNT} 个标签`
                  : (placeholder ?? '输入后回车添加')
              }
              className="h-7 min-w-24 flex-1 bg-transparent px-0.5 text-sm outline-none placeholder:text-neutral-400 dark:text-neutral-100"
            />
          </div>
        </SortableContext>
      </DndContext>

      {activeTag && (
        <ModelTagEditor
          key={activeTag.draftId}
          tag={activeTag}
          error={activeTagError}
          onChange={(changes) =>
            onChange(
              tags.map((tag) => (tag.draftId === activeTag.draftId ? { ...tag, ...changes } : tag)),
            )
          }
          onClose={closeEditor}
        />
      )}

      <p id={descriptionId} className="mt-1 text-xs leading-5 text-neutral-400">
        拖动标签调整顺序，点击修改文字和颜色。每个不超过 {MODEL_TAG_MAX_LABEL_LENGTH} 字，最多{' '}
        {MODEL_TAG_MAX_COUNT} 个。
      </p>
    </Field>
  )
}
