import { create } from 'zustand'
import type { MessageQueueDTO } from '@shared/schemas/message-queue'

export type { QueuedMessage } from '@shared/schemas/message-queue'
export type ConversationMessageQueue = MessageQueueDTO

interface MessageQueueStore {
  byConversation: Record<string, MessageQueueDTO>
  epoch: number
  apply: (queues: MessageQueueDTO[]) => void
  clear: (conversationId?: string) => void
}

/** 这里只缓存云端快照；较旧的 HTTP 响应不能覆盖后到的 SSE 状态。 */
export const useMessageQueue = create<MessageQueueStore>((set) => ({
  byConversation: {},
  epoch: 0,
  apply: (queues) =>
    set((state) => {
      const next = { ...state.byConversation }
      let changed = false
      for (const queue of queues) {
        if (next[queue.conversationId] && next[queue.conversationId]!.revision >= queue.revision)
          continue
        next[queue.conversationId] = queue
        changed = true
      }
      return changed ? { byConversation: next } : state
    }),
  clear: (conversationId) =>
    set((state) => {
      if (!conversationId) return { byConversation: {}, epoch: state.epoch + 1 }
      const next = { ...state.byConversation }
      delete next[conversationId]
      return { byConversation: next, epoch: state.epoch + 1 }
    }),
}))
