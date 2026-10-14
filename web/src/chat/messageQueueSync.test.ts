import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageQueueDTO } from '@shared/schemas/message-queue'
import { syncQueuedRun } from './messageQueueSync'
import { getActiveRun } from '../api/runs'
import { getConversation } from '../api/chat'
import { startStream } from '../sse/streamManager'
import { useMessageQueue } from '../store/messageQueue'
import { useStreamStore } from '../store/stream'

vi.mock('../api/runs', () => ({ getActiveRun: vi.fn() }))
vi.mock('../api/chat', () => ({ getConversation: vi.fn() }))
vi.mock('../sse/streamManager', () => ({ startStream: vi.fn() }))
const queue: MessageQueueDTO = {
  conversationId: 'chat',
  items: [],
  parentId: 'answer',
  waitingRunId: 'run',
  sendingId: null,
  paused: false,
  error: null,
  revision: 1,
  reorderUntil: null,
}
const callbacks = { onBeforeTerminal: vi.fn(), onTerminal: vi.fn() }
const active = {
  runId: 'run',
  assistantMessageId: 'answer',
  lastSequenceNumber: 0,
  upstreamStartedAt: null,
  reasoningDurationMs: null,
  imageStartedAt: null,
  reasoningEnabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  useMessageQueue.getState().clear()
  useStreamStore.getState().clear('chat')
  useMessageQueue.getState().apply([queue])
  vi.mocked(getActiveRun).mockResolvedValue(active)
  vi.mocked(getConversation).mockResolvedValue({ messages: [] } as unknown as Awaited<
    ReturnType<typeof getConversation>
  >)
})

describe('云端队列运行衔接', () => {
  it('恢复云端 run 前刷新最终历史，同时重复同步只打开一次流', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await Promise.all([syncQueuedRun(qc, queue, callbacks), syncQueuedRun(qc, queue, callbacks)])
    expect(getActiveRun).toHaveBeenCalledTimes(1)
    expect(getConversation).toHaveBeenCalledWith('chat')
    expect(startStream).toHaveBeenCalledTimes(1)
    expect(startStream).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run', fromSeq: -1, reasoningEnabled: true }),
    )
  })
  it('等待请求时退出登录，不重新创建旧账号的流', async () => {
    vi.mocked(getConversation).mockImplementation(async () => {
      useMessageQueue.getState().clear()
      return { messages: [] } as unknown as Awaited<ReturnType<typeof getConversation>>
    })
    await syncQueuedRun(new QueryClient(), queue, callbacks)
    expect(startStream).not.toHaveBeenCalled()
  })
  it('云端已经进入下一轮时忽略旧 run 的恢复结果', async () => {
    vi.mocked(getActiveRun).mockResolvedValue({ ...active, runId: 'new-run' })
    await syncQueuedRun(new QueryClient(), queue, callbacks)
    expect(startStream).not.toHaveBeenCalled()
  })
})
