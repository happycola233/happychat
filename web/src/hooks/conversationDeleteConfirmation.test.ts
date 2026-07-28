import { describe, expect, it } from 'vitest'
import { conversationDeleteConfirmationTitle } from './conversationDeleteConfirmation'

describe('conversationDeleteConfirmationTitle', () => {
  it('在删除确认标题中展示聊天标题', () => {
    expect(conversationDeleteConfirmationTitle('旅行计划')).toBe('删除「旅行计划」？')
  })

  it('为无标题聊天展示一致的默认名称', () => {
    expect(conversationDeleteConfirmationTitle(null)).toBe('删除「新聊天」？')
    expect(conversationDeleteConfirmationTitle('   ')).toBe('删除「新聊天」？')
  })
})
