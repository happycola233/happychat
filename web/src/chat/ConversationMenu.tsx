import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { MoreHorizontal } from 'lucide-react'
import { useConversations } from '../hooks/useConversations'
import { useConversationActions } from '../hooks/useConversationActions'
import { RowMenuItem } from './RowMenuItem'
import { ShareDialog } from './ShareDialog'
import { DeleteIcon, EditIcon, PinnedIcon, ShareIcon, UnpinIcon } from './icons'

interface Props {
  conversationId: string
}

/** 重命名小对话框：顶栏菜单没有侧栏那样的行内输入位，用居中弹窗承载。 */
function RenameDialog({
  initialTitle,
  onSubmit,
  onClose,
}: {
  initialTitle: string
  onSubmit: (title: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initialTitle)

  const submit = () => {
    const title = draft.trim()
    if (title && title !== initialTitle) onSubmit(title)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="hc-pop-in relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
        <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
          重命名聊天
        </h3>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
          maxLength={100}
          className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
          aria-label="聊天标题"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3.5 py-2 text-sm text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            className="rounded-xl bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

/** 聊天顶栏右上角三点菜单：分享 / 重命名 / 置顶 / 删除（与侧栏行内菜单同一套操作）。 */
export function ConversationMenu({ conversationId }: Props) {
  const { data: conversations } = useConversations()
  const conversation = conversations?.find((c) => c.id === conversationId)
  const { deleteWithConfirm, togglePin, renameTo } = useConversationActions()
  const [open, setOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!conversation) return null
  const pinned = Boolean(conversation.pinnedAt)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="conversation-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="会话操作"
        title="会话操作"
        className={clsx(
          'rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
          open && 'bg-neutral-100 dark:bg-neutral-800',
        )}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>

      {open && (
        <div className="hc-pop-in absolute right-0 top-full z-40 mt-1 w-40 origin-top-right rounded-xl border border-neutral-200 bg-white p-1 text-[13px] shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
          <RowMenuItem
            icon={<ShareIcon className="h-4 w-4" />}
            onClick={() => {
              setOpen(false)
              setSharing(true)
            }}
          >
            分享
          </RowMenuItem>
          <RowMenuItem
            icon={<EditIcon className="h-4 w-4" />}
            onClick={() => {
              setOpen(false)
              setRenaming(true)
            }}
          >
            重命名
          </RowMenuItem>
          <RowMenuItem
            icon={pinned ? <UnpinIcon className="h-4 w-4" /> : <PinnedIcon className="h-4 w-4" />}
            onClick={() => {
              setOpen(false)
              togglePin(conversation.id, !pinned)
            }}
          >
            {pinned ? '取消置顶' : '置顶'}
          </RowMenuItem>
          <RowMenuItem
            icon={<DeleteIcon className="h-4 w-4" />}
            danger
            onClick={() => {
              setOpen(false)
              deleteWithConfirm(conversation.id)
            }}
          >
            删除
          </RowMenuItem>
        </div>
      )}

      {sharing && <ShareDialog conversationId={conversation.id} onClose={() => setSharing(false)} />}
      {renaming && (
        <RenameDialog
          initialTitle={conversation.title ?? '新聊天'}
          onSubmit={(title) => renameTo(conversation.id, title)}
          onClose={() => setRenaming(false)}
        />
      )}
    </div>
  )
}
