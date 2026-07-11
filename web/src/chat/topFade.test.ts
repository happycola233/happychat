import { describe, expect, it } from 'vitest'
import { shouldShowTopFade } from './topFade'

describe('shouldShowTopFade', () => {
  it('空白新聊天在窄视口也不显示渐变', () => {
    expect(
      shouldShowTopFade({
        viewportWidth: 1000,
        hasConversation: false,
        hasVisibleMessages: false,
        isDocking: false,
      }),
    ).toBe(false)
  })

  it('已有消息进入顶栏按钮区域时显示渐变', () => {
    expect(
      shouldShowTopFade({
        viewportWidth: 1047,
        hasConversation: true,
        hasVisibleMessages: true,
        isDocking: false,
      }),
    ).toBe(true)
  })

  it('首条乐观消息出现后立即恢复窄视口渐变', () => {
    expect(
      shouldShowTopFade({
        viewportWidth: 1000,
        hasConversation: false,
        hasVisibleMessages: true,
        isDocking: false,
      }),
    ).toBe(true)
  })

  it('已有消息但视口留白充足时不显示渐变', () => {
    expect(
      shouldShowTopFade({
        viewportWidth: 1048,
        hasConversation: true,
        hasVisibleMessages: true,
        isDocking: false,
      }),
    ).toBe(false)
  })

  it('已有会话详情加载期间保持窄视口渐变', () => {
    expect(
      shouldShowTopFade({
        viewportWidth: 1000,
        hasConversation: true,
        hasVisibleMessages: false,
        isDocking: false,
      }),
    ).toBe(true)
  })

  it('首条消息落底交接期间保持窄视口渐变', () => {
    expect(
      shouldShowTopFade({
        viewportWidth: 1000,
        hasConversation: false,
        hasVisibleMessages: false,
        isDocking: true,
      }),
    ).toBe(true)
  })
})
