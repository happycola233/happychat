import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MessageDTO } from '@shared/types/api'
import { initialLive, type LiveMessage } from '../sse/eventReducer'
import { Message, type BranchInfo } from './Message'

function assistantMessage(
  status: MessageDTO['status'] = 'complete',
  overrides: Partial<MessageDTO> = {},
): MessageDTO {
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
    processSteps: [],
    reasoningDurationMs: null,
    generationDurationMs: null,
    annotations: null,
    usage: null,
    errorMessage: null,
    createdAt: 1,
    ...overrides,
  }
}

function siblingBranch(index = 0): BranchInfo {
  return {
    index,
    total: 2,
    siblings: [assistantMessage(), assistantMessage('complete', { id: 'assistant-2' })],
    onSelect: () => undefined,
  }
}

function renderMessage(
  message: MessageDTO,
  extras: { live?: LiveMessage; branch?: BranchInfo } = {},
) {
  const queryClient = new QueryClient()
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Message
        message={message}
        live={extras.live}
        branch={extras.branch}
        onRegenerate={() => undefined}
        onCreateBranch={() => undefined}
      />
    </QueryClientProvider>,
  )
}

function expectAssistantRecoveryActions(html: string) {
  expect(html).toContain('aria-label="重新生成"')
  expect(html).toContain('aria-label="上一个分支"')
  expect(html).toContain('1 / 2')
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

  it('does not expose actions while live streaming is in progress', () => {
    const html = renderMessage(assistantMessage('streaming'), {
      live: initialLive(),
      branch: siblingBranch(),
    })

    expect(html).not.toContain('aria-label="重新生成"')
    expect(html).not.toContain('aria-label="创建新的分支对话"')
    expect(html).not.toContain('aria-label="上一个分支"')
  })

  it('still shows retry and branch switch after a failed generation', () => {
    expectAssistantRecoveryActions(
      renderMessage(assistantMessage('error', { errorMessage: '上游失败', content: [] }), {
        branch: siblingBranch(),
      }),
    )
  })

  it('still shows retry and branch switch when live stream failed', () => {
    expectAssistantRecoveryActions(
      renderMessage(assistantMessage('streaming'), {
        live: { ...initialLive(), status: 'failed', error: '上游失败' },
        branch: siblingBranch(),
      }),
    )
  })

  it('still shows retry and branch switch when persisted streaming has no live stream', () => {
    expectAssistantRecoveryActions(
      renderMessage(assistantMessage('streaming', { content: [] }), {
        branch: siblingBranch(),
      }),
    )
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

describe('assistant citation source chips', () => {
  it('hides source chips while the code-level display switch is off', () => {
    const message: MessageDTO = {
      ...assistantMessage(),
      annotations: [
        {
          type: 'url_citation',
          url: 'https://example.com/source',
          title: '示例来源',
          start_index: 0,
          end_index: 2,
        },
      ],
    }

    const html = renderMessage(message)

    expect(html).not.toContain('https://example.com/source')
    expect(html).not.toContain('示例来源')
  })

  it('never turns non-http citation schemes into clickable links', () => {
    const message: MessageDTO = {
      ...assistantMessage(),
      annotations: [
        {
          type: 'url_citation',
          url: 'javascript:alert(1)',
          title: '恶意来源',
          start_index: 0,
          end_index: 1,
        },
        {
          type: 'url_citation',
          url: 'data:text/html,unsafe',
          title: '数据链接',
          start_index: 1,
          end_index: 2,
        },
      ],
    }

    const html = renderMessage(message)
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('data:text/html')
    expect(html).not.toContain('恶意来源')
    expect(html).not.toContain('数据链接')
  })
})
