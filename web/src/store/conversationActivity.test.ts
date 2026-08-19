import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialLive } from '../sse/eventReducer'
import {
  compactActivityText,
  completionPreviewFromStream,
  isNotifiableCompletionStatus,
  shouldRecordBackgroundCompletion,
  useConversationActivityStore,
  type ConversationCompletionNotice,
} from './conversationActivity'

const notice = (
  patch: Partial<ConversationCompletionNotice> = {},
): ConversationCompletionNotice => ({
  id: 'run-1',
  runId: 'run-1',
  conversationId: 'conversation-1',
  title: '测试会话',
  message: '回复正文',
  ...patch,
})

beforeEach(() => {
  vi.useFakeTimers()
  useConversationActivityStore.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('conversation activity', () => {
  it('only treats completed and incomplete replies as notifiable completions', () => {
    expect(isNotifiableCompletionStatus('completed')).toBe(true)
    expect(isNotifiableCompletionStatus('incomplete')).toBe(true)
    expect(isNotifiableCompletionStatus('failed')).toBe(false)
    expect(isNotifiableCompletionStatus('canceled')).toBe(false)
    expect(isNotifiableCompletionStatus('interrupted')).toBe(false)
  })

  it('records completion only for the matching run outside the visible conversation', () => {
    const stream = { runId: 'run-1', status: 'completed' as const }
    const base = {
      conversationId: 'conversation-1',
      runId: 'run-1',
      stream,
    }

    expect(
      shouldRecordBackgroundCompletion({ ...base, currentConversationId: 'conversation-2' }),
    ).toBe(true)
    expect(
      shouldRecordBackgroundCompletion({ ...base, currentConversationId: 'conversation-1' }),
    ).toBe(false)
    expect(
      shouldRecordBackgroundCompletion({
        ...base,
        currentConversationId: 'conversation-2',
        runId: 'another-run',
      }),
    ).toBe(false)
    expect(
      shouldRecordBackgroundCompletion({
        ...base,
        currentConversationId: 'conversation-2',
        stream: { runId: 'run-1', status: 'failed' },
      }),
    ).toBe(false)
  })

  it('normalizes streamed text for a compact notification preview', () => {
    const stream = {
      ...initialLive(),
      text: '  第一行\n\n第二行   with spaces  ',
    }
    expect(completionPreviewFromStream(stream)).toBe('第一行 第二行 with spaces')
    expect(compactActivityText('😀😀😀', 2)).toBe('😀…')
  })

  it('falls back to generated-image copy when the reply has no text', () => {
    const stream = {
      ...initialLive(),
      imageGenerations: [
        {
          id: 'image-1',
          index: 0,
          outputIndex: 0,
          status: 'done' as const,
          attachmentId: 'attachment-1',
          previewIndex: null,
          previewUpdatedAt: null,
          startedAt: 1,
          completedAt: 2,
        },
      ],
    }
    expect(completionPreviewFromStream(stream)).toBe('图片已生成')
  })

  it('keeps the unread dot after the floating notice expires', () => {
    useConversationActivityStore.getState().recordBackgroundCompletion(notice())

    expect(useConversationActivityStore.getState().unreadRunByConversation).toEqual({
      'conversation-1': 'run-1',
    })
    expect(useConversationActivityStore.getState().completionNotices).toHaveLength(1)

    vi.advanceTimersByTime(7000)
    expect(useConversationActivityStore.getState().completionNotices).toEqual([])
    expect(useConversationActivityStore.getState().unreadRunByConversation).toEqual({
      'conversation-1': 'run-1',
    })
  })

  it('clears both the unread dot and pending notice when the conversation is viewed', () => {
    useConversationActivityStore.getState().recordBackgroundCompletion(notice())
    useConversationActivityStore.getState().markViewed('conversation-1')

    expect(useConversationActivityStore.getState().unreadRunByConversation).toEqual({})
    expect(useConversationActivityStore.getState().completionNotices).toEqual([])
  })

  it('deduplicates terminal replay for the same run', () => {
    const store = useConversationActivityStore.getState()
    store.recordBackgroundCompletion(notice())
    store.recordBackgroundCompletion(notice())

    expect(useConversationActivityStore.getState().completionNotices).toHaveLength(1)
  })

  it('refreshes a pending completion notice when the generated title arrives', () => {
    const store = useConversationActivityStore.getState()
    store.recordBackgroundCompletion(notice({ title: '首条消息临时标题' }))
    store.updateConversationTitle('conversation-1', '  精炼后的标题  ')

    expect(useConversationActivityStore.getState().completionNotices[0]?.title).toBe('精炼后的标题')
  })
})
