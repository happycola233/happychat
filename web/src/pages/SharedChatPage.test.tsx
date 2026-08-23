import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MessageDTO } from '@shared/types/api'
import { SharedMessage } from './SharedChatPage'

const LONG_URL = `https://example.com/${'a'.repeat(160)}`

function userMessage(text: string): MessageDTO {
  return {
    id: 'user-1',
    conversationId: 'conversation-1',
    parentId: null,
    role: 'user',
    status: 'complete',
    content: [{ type: 'input_text', text }],
    modelId: null,
    modelLabel: null,
    runId: null,
    reasoningSummary: null,
    reasoningDurationMs: null,
    generationDurationMs: null,
    annotations: null,
    usage: null,
    errorMessage: null,
    createdAt: 1,
  }
}

describe('shared user message', () => {
  it('allows an uninterrupted URL to wrap inside the message bubble', () => {
    const html = renderToStaticMarkup(
      <SharedMessage
        m={userMessage(LONG_URL)}
        token="share-token"
        showCost={false}
        costDisplay={{ currency: 'USD', usdToCnyRate: null }}
      />,
    )

    expect(html).toContain('[overflow-wrap:anywhere]')
    expect(html).toContain(LONG_URL)
  })
})
