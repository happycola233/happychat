import type { ConversationDetail } from '@shared/types/api'

function hasPersistedStreamingAssistant(detail: ConversationDetail): boolean {
  return detail.messages.some(
    (message) => message.role === 'assistant' && message.status === 'streaming',
  )
}

/**
 * 协调 `/runs/active` 与会话详情两个并行请求。
 *
 * run 可能刚好在两个请求之间完成：active 已返回 null，但较早发出的详情仍带着 streaming
 * 占位。Gate 同时覆盖“详情先到”和“active 先到”，并且每次 probe 最多触发一次刷新。
 */
export class ActiveRunRecoveryGate {
  private conversationWithoutActiveRun: string | null = null

  reset(): void {
    this.conversationWithoutActiveRun = null
  }

  markNoActiveRun(conversationId: string): void {
    this.conversationWithoutActiveRun = conversationId
  }

  consumeRefreshIfNeeded(conversationId: string, detail: ConversationDetail | undefined): boolean {
    if (
      this.conversationWithoutActiveRun !== conversationId ||
      !detail ||
      detail.conversation.id !== conversationId
    ) {
      return false
    }

    if (!hasPersistedStreamingAssistant(detail)) return false

    // 只有确实看见旧 streaming 占位时才消费。complete 缓存可能先到，随后在途的旧详情
    // 才覆盖为 streaming；保留 marker 才能覆盖这种反向响应顺序。
    this.conversationWithoutActiveRun = null
    return true
  }
}
