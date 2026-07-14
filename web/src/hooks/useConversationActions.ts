import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ConversationDTO, ConversationDetail } from '@shared/types/api'
import {
  batchDeleteConversations,
  deleteConversation,
  moveConversationsToFolder,
  pinConversation,
  renameConversation,
} from '../api/chat'
import { askConfirm } from '../store/confirm'
import { useTitleTypingStore } from '../store/titleTyping'
import { toast } from '../store/toast'

/** 会话操作（删除/置顶/重命名/移动到文件夹/批量），侧栏行内菜单、顶栏菜单与批量工具栏共用。 */
export function useConversationActions() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { id: activeId } = useParams()

  const remove = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_r, deletedId) => {
      useTitleTypingStore.getState().clear(deletedId)
      qc.invalidateQueries({ queryKey: ['conversations'] })
      if (deletedId === activeId) navigate('/')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  })

  const batchRemove = useMutation({
    mutationFn: ({ ids }: { ids: string[]; onDone?: () => void }) => batchDeleteConversations(ids),
    onSuccess: (deletedCount, { ids, onDone }) => {
      ids.forEach((conversationId) => useTitleTypingStore.getState().clear(conversationId))
      qc.invalidateQueries({ queryKey: ['conversations'] })
      toast.success(`已删除 ${deletedCount} 个聊天`)
      if (activeId && ids.includes(activeId)) navigate('/')
      onDone?.()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '批量删除失败'),
  })

  const move = useMutation({
    mutationFn: ({
      ids,
      folderId,
    }: {
      ids: string[]
      folderId: string | null
      folderName?: string
      onDone?: () => void
    }) => moveConversationsToFolder(ids, folderId),
    onSuccess: (movedCount, { folderId, folderName, onDone }) => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      if (folderId) {
        toast.success(`已将 ${movedCount} 个聊天移动到「${folderName ?? '文件夹'}」`)
      } else {
        toast.success(`已将 ${movedCount} 个聊天移出文件夹`)
      }
      onDone?.()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '移动失败'),
  })

  const pin = useMutation({
    mutationFn: ({ convId, pinned }: { convId: string; pinned: boolean }) =>
      pinConversation(convId, pinned),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation', updated.id] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '置顶失败'),
  })

  const rename = useMutation({
    mutationFn: ({ convId, title }: { convId: string; title: string }) =>
      renameConversation(convId, title),
    onSuccess: (_result, { convId, title }) => {
      // 手动重命名应立即成为列表、当前会话和标签页的同一真值。
      useTitleTypingStore.getState().clear(convId)
      qc.setQueryData<ConversationDTO[]>(['conversations'], (current) =>
        current?.map((conversation) =>
          conversation.id === convId ? { ...conversation, title } : conversation,
        ),
      )
      qc.setQueryData<ConversationDetail>(['conversation', convId], (current) =>
        current
          ? {
              ...current,
              conversation: { ...current.conversation, title },
            }
          : current,
      )
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '重命名失败'),
  })

  const deleteWithConfirm = (conversationId: string) => {
    void askConfirm({
      title: '删除聊天？',
      description: '该聊天及其全部消息、附件将被永久删除，且无法恢复。',
      confirmLabel: '删除',
      tone: 'danger',
    }).then((confirmed) => {
      if (confirmed) remove.mutate(conversationId)
    })
  }

  /** 批量删除前确认（数量写进标题，避免误删）。 */
  const batchDeleteWithConfirm = (ids: string[], onDone?: () => void) => {
    void askConfirm({
      title: `删除 ${ids.length} 个聊天？`,
      description: '所选聊天及其全部消息、附件将被永久删除，且无法恢复。',
      confirmLabel: '删除',
      tone: 'danger',
    }).then((confirmed) => {
      if (confirmed) batchRemove.mutate({ ids, onDone })
    })
  }

  /** 移动一批（或单个）会话到文件夹；folderId=null 表示移出文件夹。 */
  const moveToFolder = (
    ids: string[],
    folderId: string | null,
    folderName?: string,
    onDone?: () => void,
  ) => {
    move.mutate({ ids, folderId, folderName, onDone })
  }

  const togglePin = (conversationId: string, pinned: boolean) => {
    pin.mutate({ convId: conversationId, pinned })
  }

  const renameTo = (conversationId: string, title: string) => {
    rename.mutate({ convId: conversationId, title })
  }

  return { deleteWithConfirm, batchDeleteWithConfirm, moveToFolder, togglePin, renameTo }
}
