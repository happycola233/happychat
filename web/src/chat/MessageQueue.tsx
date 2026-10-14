import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { clsx } from 'clsx'
import { GripVertical, LoaderCircle, MoreHorizontal, Play } from 'lucide-react'
import type { ConversationMessageQueue, QueuedMessage } from '../store/messageQueue'
import { attachmentUrl } from '../api/attachments'
import { AttachmentIcon, DeleteIcon, EditIcon, QueueIcon } from './icons'

interface Props {
  queue: ConversationMessageQueue
  onEdit: (id: string, sourceRect: DOMRect) => void
  onRemove: (id: string) => void
  onReorderStart: () => void
  onReorderEnd: (id: string | null, targetId: string | null) => void
  onResume: () => void
}

const actionClass =
  'flex h-7 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-black/[0.04] hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-400 disabled:opacity-40 dark:text-neutral-500 dark:hover:bg-white/[0.06] dark:hover:text-neutral-200'

function QueuedMessageMenu({
  index,
  disabled,
  onEdit,
}: {
  index: number
  disabled: boolean
  onEdit: () => void
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current!.getBoundingClientRect()
    setPosition({ top: Math.max(8, rect.top - 48), left: Math.max(8, rect.right - 144) })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    // 生成时聊天区会自动滚动；只更新锚点，不能因此关闭用户正在操作的菜单。
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`第 ${index + 1} 条排队消息的更多操作`}
        title="更多操作"
        disabled={disabled}
        className={actionClass}
        onClick={updatePosition}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {/* 原生浮层进入顶层，队列滚动区和输入框不会裁切编辑菜单。 */}
      <div
        id={id}
        ref={panelRef}
        popover="auto"
        role="menu"
        aria-label="排队消息操作"
        style={position}
        onToggle={(event) => {
          setOpen(event.newState === 'open')
          if (event.newState === 'open') panelRef.current?.querySelector('button')?.focus()
        }}
        className="fixed inset-auto m-0 w-36 rounded-xl border border-black/[0.06] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-neutral-800"
      >
        <button
          type="button"
          role="menuitem"
          disabled={disabled}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-700 outline-none hover:bg-neutral-100 focus-visible:bg-neutral-100 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
          onClick={() => {
            panelRef.current?.hidePopover()
            onEdit()
          }}
        >
          <EditIcon className="h-4 w-4" />
          编辑消息
        </button>
      </div>
    </>
  )
}

function SortableQueuedMessage({
  message,
  index,
  sending,
  onEdit,
  onRemove,
}: {
  message: QueuedMessage
  index: number
  sending: boolean
} & Pick<Props, 'onEdit' | 'onRemove'>) {
  const rowRef = useRef<HTMLLIElement>(null)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: message.id, disabled: sending })
  const setRowRef = useCallback(
    (element: HTMLLIElement | null) => {
      rowRef.current = element
      setNodeRef(element)
    },
    [setNodeRef],
  )
  const edit = () => onEdit(message.id, rowRef.current!.getBoundingClientRect())
  const previews = [
    ...message.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      label: attachment.filename,
    })),
    ...message.imageSources.map((source) => ({
      id: source.attachmentId,
      kind: 'image' as const,
      label: source.label,
    })),
  ]
  const imageCount = previews.filter((item) => item.kind === 'image').length
  const fileCount = previews.length - imageCount
  const referenceCount = message.input.contextAttachments?.include.length ?? 0
  const attachmentLabel = [
    imageCount && `${imageCount} 张图像`,
    fileCount && `${fileCount} 个文件`,
    referenceCount && `${referenceCount} 个引用附件`,
  ]
    .filter(Boolean)
    .join('、')

  return (
    <li
      ref={setRowRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={clsx(
        'group relative flex min-h-8 items-start gap-2 rounded-lg pl-5 pr-2 motion-reduce:!transition-none',
        isDragging && 'z-10 bg-neutral-50 shadow-sm dark:bg-neutral-700',
      )}
      data-testid="queued-message"
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        disabled={sending}
        aria-label={`拖动第 ${index + 1} 条排队消息`}
        aria-roledescription="可排序消息"
        title="拖动排序"
        className={clsx(
          'absolute left-0.5 top-0.5 flex h-7 w-4 touch-none cursor-grab items-center justify-center rounded text-neutral-400 transition-opacity select-none active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-neutral-400 dark:text-neutral-500',
          sending
            ? 'invisible'
            : isDragging
              ? 'opacity-100'
              : 'opacity-100 md:[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
      >
        <GripVertical className="h-3 w-3" />
      </button>
      {sending ? (
        <LoaderCircle className="mt-2 h-4 w-4 shrink-0 animate-spin text-neutral-400 motion-reduce:animate-none" />
      ) : (
        <QueueIcon className="mt-2 h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
      )}
      <button
        type="button"
        disabled={sending}
        onClick={edit}
        title={`${message.input.text || attachmentLabel}\n${message.modelName}`}
        aria-label={`编辑第 ${index + 1} 条排队消息`}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 text-left text-sm leading-5 text-neutral-800 focus-visible:outline-2 focus-visible:outline-neutral-400 dark:text-neutral-200"
      >
        {previews.length > 0 && (
          <span aria-label={attachmentLabel} className="flex shrink-0 -space-x-1">
            {previews.slice(0, 3).map((preview) => (
              <span
                key={preview.id}
                className="flex h-6 w-6 items-center justify-center overflow-hidden rounded border border-black/10 bg-neutral-50 dark:border-white/15 dark:bg-neutral-900"
              >
                {preview.kind === 'image' ? (
                  <img
                    src={attachmentUrl(preview.id)}
                    alt={preview.label}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <AttachmentIcon className="h-3.5 w-3.5 text-neutral-400" />
                )}
              </span>
            ))}
          </span>
        )}
        <span className="min-w-0 truncate">{message.input.text.trim() || attachmentLabel}</span>
      </button>
      <div className="flex shrink-0 items-center self-start pt-0.5">
        <button
          type="button"
          onClick={() => onRemove(message.id)}
          disabled={sending}
          aria-label={`删除第 ${index + 1} 条排队消息`}
          title="删除"
          className={actionClass}
        >
          <DeleteIcon className="h-4 w-4" />
        </button>
        <QueuedMessageMenu index={index} disabled={sending} onEdit={edit} />
      </div>
    </li>
  )
}

export function MessageQueue({
  queue,
  onEdit,
  onRemove,
  onResume,
  onReorderStart,
  onReorderEnd,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const draggingRef = useRef(false)
  const reorderEndRef = useRef(onReorderEnd)
  useEffect(() => {
    reorderEndRef.current = onReorderEnd
  }, [onReorderEnd])
  useEffect(
    () => () => {
      // 拖动时切换聊天也要释放占用，后台队列才能继续。
      if (draggingRef.current) reorderEndRef.current(null, null)
    },
    [],
  )

  const endReorder = (event?: DragEndEvent) => {
    draggingRef.current = false
    onReorderEnd(event ? String(event.active.id) : null, event?.over ? String(event.over.id) : null)
  }

  if (!queue.items.length) return null
  return (
    <section
      aria-label="待发送消息"
      className="pointer-events-auto relative mx-auto -mb-6 max-w-3xl px-3"
    >
      <div className="rounded-t-[20px] border border-b-0 border-black/[0.06] bg-white pb-7 pt-1 dark:border-white/[0.04] dark:bg-[#292929]">
        <p role="status" className="sr-only">
          {queue.items.length} 条消息待发送{queue.paused ? '，已暂停' : ''}
        </p>
        {queue.paused && (
          <div className="flex items-start justify-between gap-3 py-1.5 pl-11 pr-2">
            <p className="min-w-0 break-words text-xs leading-5 text-neutral-600 dark:text-neutral-300">
              {queue.error ?? '队列已暂停'}
            </p>
            <button
              type="button"
              onClick={onResume}
              disabled={Boolean(queue.sendingId)}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-black/5 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-white/10"
            >
              <Play className="h-3 w-3" />
              继续发送
            </button>
          </div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={() => {
            draggingRef.current = true
            onReorderStart()
          }}
          onDragEnd={endReorder}
          onDragCancel={() => endReorder()}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                '按空格或回车开始移动，使用方向键调整位置，再按空格或回车完成，按 Escape 取消。',
            },
            announcements: {
              onDragStart: ({ active }) =>
                `开始移动第 ${active.data.current?.sortable.index + 1} 条消息。`,
              onDragOver: ({ over }) =>
                over ? `移到第 ${over.data.current?.sortable.index + 1} 个位置。` : undefined,
              onDragEnd: ({ over }) =>
                over
                  ? `已移到第 ${over.data.current?.sortable.index + 1} 个位置。`
                  : '消息顺序未改变。',
              onDragCancel: () => '已取消移动，消息顺序未改变。',
            },
          }}
        >
          <SortableContext
            items={queue.items.map((message) => message.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="hc-scrollbar max-h-[min(32dvh,280px)] overflow-y-auto overscroll-contain">
              {queue.items.map((message, index) => (
                <SortableQueuedMessage
                  key={message.id}
                  message={message}
                  index={index}
                  sending={queue.sendingId === message.id}
                  onEdit={onEdit}
                  onRemove={onRemove}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </div>
    </section>
  )
}
