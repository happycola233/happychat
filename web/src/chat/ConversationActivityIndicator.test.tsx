import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { conversationActivityLabel } from '../store/conversationActivity'
import { ConversationActivityIndicator } from './ConversationActivityIndicator'

describe('ConversationActivityIndicator', () => {
  it('renders a neutral spinner while a background reply is generating', () => {
    const html = renderToStaticMarkup(<ConversationActivityIndicator state="generating" />)

    expect(html).toContain('data-conversation-activity="generating"')
    expect(html).toContain('hc-conversation-spinner')
    expect(html).toContain('<svg')
    expect(html).toContain('stroke-width="2.5"')
    expect(html).toContain('stroke-linecap="round"')
    expect(conversationActivityLabel('generating')).toBe('正在生成回复')
  })

  it('renders the accent-aware dot for an unread completed reply', () => {
    const html = renderToStaticMarkup(<ConversationActivityIndicator state="unread" />)

    expect(html).toContain('data-conversation-activity="unread"')
    expect(html).toContain('hc-conversation-unread-dot')
    expect(conversationActivityLabel('unread')).toBe('有未查看的新回复')
  })
})
