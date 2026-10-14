import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageQueueDTO } from '@shared/schemas/message-queue'
import { changeMessageQueue } from './messageQueues'
import { apiPost } from './client'
import { useMessageQueue } from '../store/messageQueue'

vi.mock('./client', () => ({ apiPost: vi.fn(), apiGet: vi.fn() }))
const queue: MessageQueueDTO = {
  conversationId: 'chat',
  items: [],
  parentId: null,
  waitingRunId: null,
  sendingId: null,
  paused: false,
  error: null,
  revision: 1,
  reorderUntil: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  useMessageQueue.getState().clear()
})

describe('队列操作同步', () => {
  it('同一聊天操作按顺序发送，前一请求失败也能提交后续恢复操作', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ queue })
    const hold = changeMessageQueue('chat', { type: 'hold' })
    const reorder = changeMessageQueue('chat', { type: 'reorder', messageId: null, targetId: null })
    await expect(hold).rejects.toThrow('offline')
    await reorder
    expect(vi.mocked(apiPost).mock.calls.map((call) => call[1])).toEqual([
      { type: 'hold' },
      { type: 'reorder', messageId: null, targetId: null },
    ])
    expect(useMessageQueue.getState().byConversation.chat).toEqual(queue)
  })
  it('退出账号后的迟到响应不恢复旧队列', async () => {
    vi.mocked(apiPost).mockImplementationOnce(async () => {
      useMessageQueue.getState().clear()
      return { queue }
    })
    await changeMessageQueue('chat', { type: 'resume' })
    expect(useMessageQueue.getState().byConversation).toEqual({})
  })
})
