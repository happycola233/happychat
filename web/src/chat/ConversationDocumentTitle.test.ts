import { describe, expect, it } from 'vitest'
import { resolveConversationDocumentTitle } from './conversationTitleValue'

describe('resolveConversationDocumentTitle', () => {
  it('uses the default-title signal on the new-chat route', () => {
    expect(resolveConversationDocumentTitle(undefined, '旧会话标题', '旧')).toBeNull()
  })

  it('uses the persisted title for an existing conversation', () => {
    expect(resolveConversationDocumentTitle('conversation-1', '完整标题', undefined)).toBe(
      '完整标题',
    )
  })

  it('prefers the live typewriter prefix until the animation finishes', () => {
    expect(resolveConversationDocumentTitle('conversation-1', '完整标题', '完整')).toBe('完整')
  })
})
