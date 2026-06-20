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

export const deleteConversation = (id: string) => apiDelete<{ ok: true }>(`/conversations/${id}`)

export const clearAllConversations = () =>
  apiDelete<{ deletedCount: number }>('/conversations').then((r) => r.deletedCount)
