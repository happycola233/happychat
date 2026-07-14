import { useEffect } from 'react'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import type { ConversationDTO, ConversationDetail } from '@shared/types/api'
import {
  CONVERSATION_EVENT_TYPE,
  type ConversationTitleUpdatedData,
  type WireEvent,
} from '@shared/types/events'
import { getConversation } from '../api/chat'
import { useTitleTypingStore } from '../store/titleTyping'

function isTitleUpdatedData(data: unknown): data is ConversationTitleUpdatedData {
  if (!data || typeof data !== 'object') return false
  const candidate = data as Record<string, unknown>
  return (
    typeof candidate.conversationId === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.updatedAt === 'number'
  )
}

export function currentCachedConversationTitle(
  queryClient: QueryClient,
  conversationId: string,
): string | null {
  const detail = queryClient.getQueryData<ConversationDetail>(['conversation', conversationId])
  if (detail?.conversation.title) return detail.conversation.title
  const list = queryClient.getQueryData<ConversationDTO[]>(['conversations'])
  return list?.find((conversation) => conversation.id === conversationId)?.title ?? null
}

export function applyConversationTitleUpdate(
  queryClient: QueryClient,
  data: ConversationTitleUpdatedData,
  options: { animate?: boolean } = {},
): void {
  const { conversationId, title, updatedAt } = data

  queryClient.setQueryData<ConversationDTO[]>(['conversations'], (old) =>
    old?.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, title, updatedAt } : conversation,
    ),
  )
  queryClient.setQueryData<ConversationDetail>(['conversation', conversationId], (old) =>
    old
      ? {
          ...old,
          conversation: {
            ...old.conversation,
            title,
            updatedAt,
          },
        }
      : old,
  )

  // 详情补刷可能先于事件拿到完整标题，因此始终交给动画层；同标题会在 store 内幂等去重。
  if (options.animate !== false) {
    useTitleTypingStore.getState().start(conversationId, title)
  }
}

const pendingTitlePolls = new Map<string, number>()
const TITLE_POLL_INTERVAL_MS = 800
const TITLE_POLL_MAX_ATTEMPTS = 30

/**
 * 标题生成在 run.done 之后异步完成。会话 SSE 是实时路径；这里作为补偿路径，
 * 防止 SSE 连接被浏览器/代理/热更新打断后，标题只能等下一次发送才显示。
 */
export function pollConversationTitleAfterRun(
  queryClient: QueryClient,
  conversationId: string,
): void {
  if (currentCachedConversationTitle(queryClient, conversationId)) return

  const existingTimer = pendingTitlePolls.get(conversationId)
  if (existingTimer !== undefined) window.clearTimeout(existingTimer)

  let attempts = 0
  const poll = async () => {
    attempts += 1
    try {
      const detail = await getConversation(conversationId)
      if (detail.conversation.title) {
        pendingTitlePolls.delete(conversationId)
        applyConversationTitleUpdate(
          queryClient,
          {
            conversationId,
            title: detail.conversation.title,
            updatedAt: detail.conversation.updatedAt,
          },
          { animate: true },
        )
        return
      }
      queryClient.setQueryData<ConversationDetail>(['conversation', conversationId], detail)
    } catch {
      // 标题补查是非关键路径；失败后继续等下一轮，避免打扰主聊天流程。
    }

    if (attempts >= TITLE_POLL_MAX_ATTEMPTS) {
      pendingTitlePolls.delete(conversationId)
      return
    }
    pendingTitlePolls.set(conversationId, window.setTimeout(poll, TITLE_POLL_INTERVAL_MS))
  }

  pendingTitlePolls.set(conversationId, window.setTimeout(poll, TITLE_POLL_INTERVAL_MS))
}

/** 订阅会话级 SSE，并把标题等轻量元数据变化直接写入 TanStack Query 缓存。 */
export function useConversationEvents(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource('/api/conversations/events', { withCredentials: true })

    source.onmessage = (event) => {
      let wire: WireEvent
      try {
        wire = JSON.parse(event.data) as WireEvent
      } catch {
        return
      }
      if (
        wire.type !== CONVERSATION_EVENT_TYPE.titleUpdated ||
        !isTitleUpdatedData(wire.data)
      ) {
        return
      }

      applyConversationTitleUpdate(queryClient, wire.data, { animate: true })
    }

    return () => source.close()
  }, [queryClient])
}
