import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteConversation, pinConversation, renameConversation } from '../api/chat'
import { toast } from '../store/toast'

/** 会话操作（删除/置顶/重命名），侧栏行内菜单与聊天顶栏三点菜单共用。 */
export function useConversationActions() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { id: activeId } = useParams()

  const remove = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_r, deletedId) => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      if (deletedId === activeId) navigate('/')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : '重命名失败'),
  })

  const deleteWithConfirm = (conversationId: string) => {
    if (confirm('确定删除该会话？')) remove.mutate(conversationId)
  }

  const togglePin = (conversationId: string, pinned: boolean) => {
    pin.mutate({ convId: conversationId, pinned })
  }

  const renameTo = (conversationId: string, title: string) => {
    rename.mutate({ convId: conversationId, title })
  }

  return { deleteWithConfirm, togglePin, renameTo }
}
