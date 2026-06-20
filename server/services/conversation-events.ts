import { CONVERSATION_EVENT_TYPE } from '@shared/types/events'

export interface ConversationEvent {
  userId: string
  sequenceNumber: number
  type: string
  data: Record<string, unknown>
}

type Listener = (event: ConversationEvent) => void

/** 进程内用户级会话事件总线：用于把标题等元数据变化实时推给已登录前端。 */
class ConversationEvents {
  private nextSequenceNumber = 0
  private subscribers = new Map<string, Set<Listener>>()

  subscribe(userId: string, listener: Listener): () => void {
    let listeners = this.subscribers.get(userId)
    if (!listeners) {
      listeners = new Set()
      this.subscribers.set(userId, listeners)
    }
    listeners.add(listener)
    return () => {
      const current = this.subscribers.get(userId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.subscribers.delete(userId)
    }
  }

  emit(userId: string, type: string, data: Record<string, unknown>): ConversationEvent {
    const event = {
      userId,
      sequenceNumber: this.nextSequenceNumber++,
      type,
      data,
    }
    this.subscribers.get(userId)?.forEach((listener) => listener(event))
    return event
  }

  emitTitleUpdated(userId: string, conversationId: string, title: string, updatedAt: Date): void {
    this.emit(userId, CONVERSATION_EVENT_TYPE.titleUpdated, {
      conversationId,
      title,
      updatedAt: updatedAt.getTime(),
    })
  }
}

export const conversationEvents = new ConversationEvents()
