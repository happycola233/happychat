import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { MessageQueueDTO } from '@shared/schemas/message-queue'
import { getConversation } from '../api/chat'
import { listMessageQueues } from '../api/messageQueues'
import { getActiveRun } from '../api/runs'
import { useMessageQueue } from '../store/messageQueue'
import { useStreamStore } from '../store/stream'
import { startStream } from '../sse/streamManager'

export interface QueueRunCallbacks {
  onBeforeTerminal: (conversationId: string) => void
  onTerminal: (conversationId: string, runId: string) => void
}

const reconnecting = new Set<string>()

/** 仅衔接云端已经创建的 run；任何标签页都不会自行消费待发消息。 */
export async function syncQueuedRun(
  qc: QueryClient,
  queue: MessageQueueDTO,
  callbacks: QueueRunCallbacks,
): Promise<void> {
  const { conversationId, waitingRunId } = queue
  const current = useStreamStore.getState().byConversation[conversationId]
  if (
    !waitingRunId ||
    (current?.runId === waitingRunId && current.status !== 'interrupted') ||
    reconnecting.has(waitingRunId)
  )
    return
  const epoch = useMessageQueue.getState().epoch
  reconnecting.add(waitingRunId)
  try {
    const active = await getActiveRun(conversationId)
    if (!active || active.runId !== waitingRunId) return
    await qc.cancelQueries({ queryKey: ['conversation', conversationId] })
    await qc.fetchQuery({
      queryKey: ['conversation', conversationId],
      queryFn: () => getConversation(conversationId),
      staleTime: 0,
    })
    if (
      useMessageQueue.getState().epoch !== epoch ||
      useMessageQueue.getState().byConversation[conversationId]?.waitingRunId !== waitingRunId
    )
      return
    startStream({
      ...active,
      conversationId,
      fromSeq: -1,
      onBeforeTerminal: () => callbacks.onBeforeTerminal(conversationId),
      onTerminal: () => callbacks.onTerminal(conversationId, active.runId),
    })
  } finally {
    reconnecting.delete(waitingRunId)
  }
}

export function useMessageQueueSync(callbacks: QueueRunCallbacks) {
  const qc = useQueryClient()
  const queues = useMessageQueue((state) => state.byConversation)
  const query = useQuery({ queryKey: ['message-queues'], queryFn: listMessageQueues })
  useEffect(() => {
    if (query.data) useMessageQueue.getState().apply(query.data)
  }, [query.data])
  const { onBeforeTerminal, onTerminal } = callbacks
  useEffect(() => {
    for (const queue of Object.values(queues)) {
      void syncQueuedRun(qc, queue, { onBeforeTerminal, onTerminal }).catch(() => {
        // 网络中断不改变云端队列；连接恢复时会话 SSE ready 会重新拉取。
      })
    }
  }, [queues, query.dataUpdatedAt, qc, onBeforeTerminal, onTerminal])
  return query
}
