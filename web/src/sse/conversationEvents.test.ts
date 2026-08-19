import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationDTO } from '@shared/types/api'
import { useConversationActivityStore } from '../store/conversationActivity'
import { useTitleTypingStore } from '../store/titleTyping'
import { applyConversationTitleUpdate } from './conversationEvents'

const CONVERSATION_ID = 'conversation-title-test'

function conversation(title: string | null): ConversationDTO {
  return {
    id: CONVERSATION_ID,
    title,
    modelId: null,
    folderId: null,
    activeLeafId: null,
    pinnedAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    setTimeout: (callback: TimerHandler, delay?: number) =>
      globalThis.setTimeout(callback, delay) as unknown as number,
    clearTimeout: (timer: number) => globalThis.clearTimeout(timer),
  })
  useTitleTypingStore.getState().clear(CONVERSATION_ID)
  useConversationActivityStore.getState().reset()
})

afterEach(() => {
  useTitleTypingStore.getState().clear(CONVERSATION_ID)
  useConversationActivityStore.getState().reset()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('applyConversationTitleUpdate', () => {
  it('starts typing even when a detail refresh cached the full title before the event', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<ConversationDTO[]>(['conversations'], [conversation('🤖性能优化')])

    applyConversationTitleUpdate(queryClient, {
      conversationId: CONVERSATION_ID,
      title: '🤖性能优化',
      updatedAt: 2,
    })

    expect(useTitleTypingStore.getState().byConversation[CONVERSATION_ID]).toMatchObject({
      text: '🤖',
      active: true,
    })
  })

  it('does not restart an animation when the SSE and polling paths report the same title', () => {
    const queryClient = new QueryClient()
    const update = {
      conversationId: CONVERSATION_ID,
      title: '性能优化',
      updatedAt: 2,
    }

    applyConversationTitleUpdate(queryClient, update)
    vi.advanceTimersByTime(48)
    expect(useTitleTypingStore.getState().byConversation[CONVERSATION_ID]?.text).toBe('性能')

    applyConversationTitleUpdate(queryClient, update)
    expect(useTitleTypingStore.getState().byConversation[CONVERSATION_ID]?.text).toBe('性能')

    vi.runAllTimers()
    expect(useTitleTypingStore.getState().byConversation[CONVERSATION_ID]).toBeUndefined()

    // 即使轮询响应迟到动画结束之后，同一标题也不能从头重播。
    applyConversationTitleUpdate(queryClient, update)
    expect(useTitleTypingStore.getState().byConversation[CONVERSATION_ID]).toBeUndefined()
  })

  it('keeps a visible completion notice in sync with the generated title', () => {
    const queryClient = new QueryClient()
    useConversationActivityStore.getState().recordBackgroundCompletion({
      id: 'run-title-test',
      runId: 'run-title-test',
      conversationId: CONVERSATION_ID,
      title: '首条消息临时标题',
      message: '回复正文',
    })

    applyConversationTitleUpdate(queryClient, {
      conversationId: CONVERSATION_ID,
      title: '自动生成的标题',
      updatedAt: 2,
    })

    expect(useConversationActivityStore.getState().completionNotices[0]?.title).toBe(
      '自动生成的标题',
    )
  })
})
