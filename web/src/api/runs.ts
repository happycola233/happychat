import type { ConversationDTO, MessageDTO } from '@shared/types/api'
import type { RegenerateInput, SendMessageInput } from '@shared/schemas/chat'
import { apiDelete, apiGet, apiPost } from './client'

export interface StartRunResult {
  runId: string
  conversation: ConversationDTO
  userMessage: MessageDTO
  assistantMessage: MessageDTO
}

export interface RegenerateResult {
  runId: string
  conversation: ConversationDTO
  assistantMessage: MessageDTO
}

export interface ActiveRunInfo {
  runId: string
  assistantMessageId: string
  lastSequenceNumber: number
}

export const startRun = (input: SendMessageInput) => apiPost<StartRunResult>('/runs', input)

export const regenerateRun = (input: RegenerateInput) =>
  apiPost<RegenerateResult>('/runs/regenerate', input)

export const getActiveRun = (conversationId: string) =>
  apiGet<{ run: ActiveRunInfo | null }>(
    `/runs/active?conversationId=${encodeURIComponent(conversationId)}`,
  ).then((r) => r.run)

export const abortRun = (runId: string) => apiDelete<{ ok: true }>(`/runs/${runId}`)
