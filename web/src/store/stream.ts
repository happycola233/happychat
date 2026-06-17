import { create } from 'zustand'
import type { LiveMessage } from '../sse/eventReducer'

export interface ActiveStream extends LiveMessage {
  runId: string
  assistantMessageId: string
}

interface StreamStore {
  /** 按会话 id 保存当前流式状态（支持多个会话并发流式，互不阻塞） */
  byConversation: Record<string, ActiveStream>
  set: (conversationId: string, s: ActiveStream) => void
  patch: (conversationId: string, partial: Partial<ActiveStream>) => void
  clear: (conversationId: string) => void
}

export const useStreamStore = create<StreamStore>((set) => ({
  byConversation: {},
  set: (conversationId, s) =>
    set((st) => ({ byConversation: { ...st.byConversation, [conversationId]: s } })),
  patch: (conversationId, partial) =>
    set((st) => {
      const cur = st.byConversation[conversationId]
      if (!cur) return st
      return { byConversation: { ...st.byConversation, [conversationId]: { ...cur, ...partial } } }
    }),
  clear: (conversationId) =>
    set((st) => {
      const next = { ...st.byConversation }
      delete next[conversationId]
      return { byConversation: next }
    }),
}))
