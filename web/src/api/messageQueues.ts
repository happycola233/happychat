import type { MessageQueueAction, MessageQueueDTO } from '@shared/schemas/message-queue'
import { apiGet, apiPost } from './client'
import { useMessageQueue } from '../store/messageQueue'

export const listMessageQueues = () =>
  apiGet<{ queues: MessageQueueDTO[] }>('/message-queues').then((r) => r.queues)

const mutations = new Map<string, Promise<unknown>>()

export async function changeMessageQueue(
  conversationId: string,
  action: MessageQueueAction,
): Promise<MessageQueueDTO> {
  const epoch = useMessageQueue.getState().epoch
  const previous = mutations.get(conversationId)
  // 尤其保证拖动的 hold→reorder 顺序，不让晚到的 hold 把队列重新挂起。
  const request = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      apiPost<{ queue: MessageQueueDTO }>(
        `/message-queues/${encodeURIComponent(conversationId)}`,
        action,
      ),
    )
  mutations.set(conversationId, request)
  try {
    const { queue } = await request
    if (useMessageQueue.getState().epoch === epoch) useMessageQueue.getState().apply([queue])
    return queue
  } finally {
    if (mutations.get(conversationId) === request) mutations.delete(conversationId)
  }
}
