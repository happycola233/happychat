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
    processSteps: [],
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

describe('shared interrupted replies', () => {
  it.each([null, 45])('分享快照缺少可靠思考时长（%s）时显示若干秒', (reasoningDurationMs) => {
    const html = renderToStaticMarkup(
      <SharedMessage
        m={{
          ...userMessage(''),
          role: 'assistant',
          processSteps: [{ kind: 'reasoning', text: '测试思考摘要' }],
          reasoningDurationMs,
        }}
        token="share-token"
        showCost={false}
        costDisplay={{ currency: 'USD', usdToCnyRate: null }}
      />,
    )
    expect(html).toContain('已思考若干秒')
    expect(html).not.toContain('已思考 0s')
  })

  it('keeps truncation explanations in a shared snapshot without an answer', () => {
    const html = renderToStaticMarkup(
      <SharedMessage
        m={{
          ...userMessage(''),
          role: 'assistant',
          status: 'interrupted',
          content: [],
          errorMessage: '生成因长度限制被截断',
        }}
        token="share-token"
        showCost={false}
        costDisplay={{ currency: 'USD', usdToCnyRate: null }}
      />,
    )
    expect(html).toContain('run-interruption-notice')
    expect(html).toContain('生成因长度限制被截断')
    expect(html).toContain('尚未生成最终回复。')
  })
})
