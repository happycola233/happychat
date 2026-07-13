import type {
  ConversationDTO,
  ConversationDetail,
  ConversationSearchResultDTO,
  SendResult,
} from '@shared/types/api'
import type { SendMessageInput } from '@shared/schemas/chat'
import { apiDelete, apiGet, apiPatch, apiPost } from './client'

export const listConversations = () =>
  apiGet<{ conversations: ConversationDTO[] }>('/conversations').then((r) => r.conversations)

export const getConversation = (id: string) => apiGet<ConversationDetail>(`/conversations/${id}`)

export const sendMessage = (input: SendMessageInput) => apiPost<SendResult>('/chat', input)

export const renameConversation = (id: string, title: string) =>
  apiPatch<{ ok: true }>(`/conversations/${id}`, { title })

export const pinConversation = (id: string, pinned: boolean) =>
  apiPatch<{ conversation: ConversationDTO }>(`/conversations/${id}/pin`, { pinned }).then(
    (r) => r.conversation,
  )

export const searchConversations = (q: string) =>
  apiGet<{ results: ConversationSearchResultDTO[] }>(
    `/conversations/search?q=${encodeURIComponent(q)}`,
  ).then((r) => r.results)

export const switchBranch = (id: string, messageId: string) =>
  apiPost<{ activeLeafId: string }>(`/conversations/${id}/switch`, { messageId })

/** 复制 root → 指定助手消息的可见路径，创建一份独立会话。 */
export const createConversationBranch = (id: string, assistantMessageId: string) =>
  apiPost<ConversationDetail>(`/conversations/${id}/branch`, { assistantMessageId })

export const deleteConversation = (id: string) => apiDelete<{ ok: true }>(`/conversations/${id}`)

/** 批量删除会话，返回实际删除数。 */
export const batchDeleteConversations = (ids: string[]) =>
  apiPost<{ deletedCount: number }>('/conversations/batch-delete', { ids }).then(
    (r) => r.deletedCount,
  )

/** 批量移动会话到文件夹（folderId=null 表示移出），返回实际移动数。 */
export const moveConversationsToFolder = (ids: string[], folderId: string | null) =>
  apiPost<{ movedCount: number }>('/conversations/batch-move', { ids, folderId }).then(
    (r) => r.movedCount,
  )

export const clearAllConversations = () =>
  apiDelete<{ deletedCount: number }>('/conversations').then((r) => r.deletedCount)
