import { beforeEach, describe, expect, it } from 'vitest'
import type { MessageQueueDTO } from '@shared/schemas/message-queue'
import { useMessageQueue } from './messageQueue'

const snapshot: MessageQueueDTO = {
  conversationId: 'chat',
  items: [],
  parentId: null,
  waitingRunId: null,
  sendingId: null,
  paused: false,
  error: null,
  revision: 3,
  reorderUntil: null,
}
beforeEach(() => useMessageQueue.getState().clear())

describe('云端队列快照', () => {
  it('晚到的旧响应不会覆盖实时事件，也不让已删除的项复活', () => {
    const store = useMessageQueue.getState()
    store.apply([snapshot])
    store.apply([{ ...snapshot, revision: 2, paused: true }])
    expect(useMessageQueue.getState().byConversation.chat).toEqual(snapshot)
    store.apply([{ ...snapshot, revision: 4, paused: true }])
    expect(useMessageQueue.getState().byConversation.chat?.paused).toBe(true)
  })
  it('相同版本不触发重渲染，其他聊天的更新独立合并', () => {
    const store = useMessageQueue.getState()
    store.apply([snapshot])
    const before = useMessageQueue.getState().byConversation
    store.apply([{ ...snapshot }])
    expect(useMessageQueue.getState().byConversation).toBe(before)
    store.apply([{ ...snapshot, conversationId: 'other' }])
    expect(Object.keys(useMessageQueue.getState().byConversation)).toEqual(['chat', 'other'])
  })
  it('删除聊天/退出账号清除缓存并使在途请求失效', () => {
    const store = useMessageQueue.getState()
    store.apply([snapshot, { ...snapshot, conversationId: 'other' }])
    const epoch = useMessageQueue.getState().epoch
    store.clear('chat')
    expect(Object.keys(useMessageQueue.getState().byConversation)).toEqual(['other'])
    expect(useMessageQueue.getState().epoch).toBeGreaterThan(epoch)
    store.clear()
    expect(useMessageQueue.getState().byConversation).toEqual({})
  })
})
