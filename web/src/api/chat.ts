import type { ConversationDTO, ConversationDetail, SendResult } from '@shared/types/api'
import type { SendMessageInput } from '@shared/schemas/chat'
import { apiDelete, apiGet, apiPatch, apiPost } from './client'

export const listConversations = () =>
  apiGet<{ conversations: ConversationDTO[] }>('/conversations').then((r) => r.conversations)

export const getConversation = (id: string) => apiGet<ConversationDetail>(`/conversations/${id}`)

export const sendMessage = (input: SendMessageInput) => apiPost<SendResult>('/chat', input)

export const renameConversation = (id: string, title: string) =>
  apiPatch<{ ok: true }>(`/conversations/${id}`, { title })

export const switchBranch = (id: string, messageId: string) =>
  apiPost<{ activeLeafId: string }>(`/conversations/${id}/switch`, { messageId })

export const deleteConversation = (id: string) => apiDelete<{ ok: true }>(`/conversations/${id}`)
