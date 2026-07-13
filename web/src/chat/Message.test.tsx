import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MessageDTO } from '@shared/types/api'
import { Message } from './Message'

function assistantMessage(status: MessageDTO['status'] = 'complete'): MessageDTO {
  return {
    id: 'assistant-1',
    conversationId: 'conversation-1',
    parentId: 'user-1',
    role: 'assistant',
    status,
    content: [{ type: 'output_text', text: '回答', annotations: [] }],
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

function renderMessage(message: MessageDTO) {
  const queryClient = new QueryClient()
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Message message={message} onRegenerate={() => undefined} onCreateBranch={() => undefined} />
    </QueryClientProvider>,
  )
}

describe('assistant message branch action', () => {
  it('renders after the regenerate action for a completed assistant message', () => {
    const html = renderMessage(assistantMessage())

    expect(html).toContain('aria-label="重新生成"')
    expect(html).toContain('aria-label="创建新的分支对话"')
    expect(html.indexOf('aria-label="创建新的分支对话"')).toBeGreaterThan(
      html.indexOf('aria-label="重新生成"'),
    )
  })

  it('does not expose actions while persisted streaming state is waiting for SSE recovery', () => {
    const html = renderMessage(assistantMessage('streaming'))

    expect(html).not.toContain('aria-label="重新生成"')
    expect(html).not.toContain('aria-label="创建新的分支对话"')
  })

  it('never renders the assistant-only branch action on a user message', () => {
    const message: MessageDTO = {
      ...assistantMessage(),
      id: 'user-1',
      parentId: null,
      role: 'user',
      // 空正文足以验证角色分支，且避免把依赖 viewport 的折叠正文组件带进 Node SSR 测试。
      content: [],
    }

    expect(renderMessage(message)).not.toContain('aria-label="创建新的分支对话"')
  })
})
