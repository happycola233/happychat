import { describe, expect, it } from 'vitest'
import { chatColumnWidthPx } from './chatColumn'
import { shouldShowTopFade } from './topFade'

/** 默认阅读宽度档位（0）下的聊天列宽度。 */
function readingColumn(viewportWidth: number): number {
  return chatColumnWidthPx({ viewportWidth, chatWidth: 0, sideReserve: 0 })
}

describe('shouldShowTopFade', () => {
  it('空白新聊天在窄视口也不显示渐变', () => {
    expect(
      shouldShowTopFade({
        viewportWidth: 1000,
        columnWidth: readingColumn(1000),
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
        columnWidth: readingColumn(1047),
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
        columnWidth: readingColumn(1000),
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
        columnWidth: readingColumn(1048),
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
        columnWidth: readingColumn(1000),
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
        columnWidth: readingColumn(1000),
        hasConversation: false,
        hasVisibleMessages: false,
        isDocking: true,
      }),
    ).toBe(true)
  })

  it('聊天列铺开后，即使视口很宽也会因按钮压住消息而显示渐变', () => {
    const viewportWidth = 2000
    expect(
      shouldShowTopFade({
        viewportWidth,
        columnWidth: chatColumnWidthPx({ viewportWidth, chatWidth: 100, sideReserve: 56 }),
        hasConversation: true,
        hasVisibleMessages: true,
        isDocking: false,
      }),
    ).toBe(true)
    expect(
      shouldShowTopFade({
        viewportWidth,
        columnWidth: chatColumnWidthPx({ viewportWidth, chatWidth: 20, sideReserve: 56 }),
        hasConversation: true,
        hasVisibleMessages: true,
        isDocking: false,
      }),
    ).toBe(false)
  })
})
