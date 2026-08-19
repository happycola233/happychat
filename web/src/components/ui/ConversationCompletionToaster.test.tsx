import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConversationCompletionToasterView } from './ConversationCompletionToaster'

describe('ConversationCompletionToaster', () => {
  it('renders a polite, top-right completion card with conversation title and preview', () => {
    const html = renderToStaticMarkup(
      <ConversationCompletionToasterView
        notices={[
          {
            id: 'run-1',
            runId: 'run-1',
            conversationId: 'conversation-1',
            title: '解析凭据导出脚本',
            message: '这段脚本的作用很明确：从浏览器本地存储读取凭据。',
          },
        ]}
        onOpenConversation={vi.fn()}
        onDismissNotice={vi.fn()}
      />,
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('fixed right-3 top-3')
    expect(html).toContain('w-[min(26rem,calc(100vw-4.5rem))]')
    expect(html).toContain('解析凭据导出脚本')
    expect(html).toContain('这段脚本的作用很明确')
    expect(html).toContain('aria-label="打开会话：解析凭据导出脚本"')
  })

  it('keeps the live announcement but hides the card behind an open mobile sidebar', () => {
    const html = renderToStaticMarkup(
      <ConversationCompletionToasterView
        notices={[]}
        onOpenConversation={vi.fn()}
        onDismissNotice={vi.fn()}
        hideVisual
      />,
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('hidden')
    expect(html).not.toContain('hidden flex')
  })
})
