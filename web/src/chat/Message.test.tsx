import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MessageDTO } from '@shared/types/api'
import type { MessageErrorDetail, UserRole } from '@shared/types/domain'
import { initialLive, reduceEvent, type LiveMessage } from '../sse/eventReducer'
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
  extras: {
    live?: LiveMessage
    branch?: BranchInfo
    viewerRole?: UserRole
    onOpenContextSettings?: () => void
  } = {},
) {
  const queryClient = new QueryClient()
  if (extras.viewerRole) queryClient.setQueryData(['me'], { role: extras.viewerRole })
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Message
        message={message}
        live={extras.live}
        branch={extras.branch}
        onRegenerate={() => undefined}
        onCreateBranch={() => undefined}
        onOpenContextSettings={extras.onOpenContextSettings}
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
  it('shows pending dots until the upstream message starts, then switches to thinking', () => {
    const message = assistantMessage('streaming', { content: [] })
    const waiting = reduceEvent(initialLive(), {
      type: 'run.created',
      seq: 0,
      data: { reasoningEnabled: true },
      createdAt: 1000,
    })
    const pendingHtml = renderMessage(message, { live: waiting })
    expect(pendingHtml.match(/animate-bounce/g)).toHaveLength(3)
    expect(pendingHtml).not.toContain('正在思考')

    const started = reduceEvent(waiting, {
      type: 'response.created',
      seq: 1,
      data: {},
      createdAt: 3000,
    })
    const thinkingHtml = renderMessage(message, { live: started })
    expect(thinkingHtml).toContain('正在思考')
    expect(thinkingHtml).not.toContain('animate-bounce')
  })

  it.each(['waiting', 'attempting'] as const)(
    'freezes retained thinking while retry is %s',
    (phase) => {
      const html = renderMessage(assistantMessage('streaming', { content: [] }), {
        live: {
          ...initialLive(1000, true),
          reasoningDurationMs: 2500,
          processSteps: [{ kind: 'reasoning', id: 'reasoning', text: '已有思考', partKey: null }],
          retry: { phase, attempt: 2, maxAttempts: 3, nextRetryAt: null },
        },
      })
      expect(html).toContain('已思考 2s')
      expect(html).not.toContain('正在思考')
      expect(html).not.toContain('reasoning-summary-footer')
    },
  )

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

describe('assistant interrupted output', () => {
  it.each(['max_output_tokens', 'max_tokens', 'model_context_window_exceeded'])(
    'shows %s immediately from the terminal SSE event, before the history refresh',
    (incompleteReason) => {
      const live = reduceEvent(initialLive(), {
        type: 'run.done',
        seq: 2,
        data: {
          state: 'incomplete',
          incompleteReason,
          text: '',
          processSteps: [{ kind: 'reasoning', text: '已有思考' }],
        },
      })
      const html = renderMessage(assistantMessage('streaming', { content: [] }), { live })
      expect(html).toContain('run-interruption-notice')
      expect(html).toContain(
        incompleteReason === 'model_context_window_exceeded' ? '上下文长度上限' : '输出长度上限',
      )
      expect(html).toContain('尚未生成最终回复。')
      expect(html).toContain('aria-label="重新生成"')
      expect(html).not.toContain('run-error-notice')
    },
  )

  it('keeps the saved truncation notice visible after reload, including legacy messages', () => {
    const html = renderMessage(
      assistantMessage('interrupted', {
        content: [],
        processSteps: [{ kind: 'reasoning', text: '已有思考' }],
        errorMessage: '生成因长度限制被截断',
      }),
    )
    expect(html).toContain('生成因长度限制被截断')
    expect(html).toContain('尚未生成最终回复。')
  })

  it('preserves partial answers and does not describe them as absent', () => {
    const html = renderMessage(
      assistantMessage('interrupted', {
        errorMessage: '已达到输出长度上限，回复未完成。',
      }),
    )
    expect(html).toContain('输出长度上限')
    expect(html).toContain('回答')
    expect(html).not.toContain('尚未生成最终回复')
  })

  it('does not add an interruption notice to completed replies or manual stops', () => {
    expect(renderMessage(assistantMessage())).not.toContain('run-interruption-notice')
    expect(
      renderMessage(assistantMessage('interrupted', { content: [], errorMessage: '已停止生成' })),
    ).not.toContain('run-interruption-notice')
  })
})

describe('assistant failure explanation', () => {
  const failed = (errorMessage: string, errorDetail?: MessageErrorDetail) =>
    assistantMessage('error', { content: [], errorMessage, errorDetail })

  it('explains an oversized context with advice, a context action and error codes', () => {
    const html = renderMessage(
      failed('对话内容超出了模型或上游服务可处理的上限。', {
        errorType: 'invalid_request_error',
        errorCode: 'context_too_large',
        httpStatus: 413,
        retryCount: 2,
      }),
      { onOpenContextSettings: () => undefined },
    )
    expect(html).toContain('对话内容超出了模型或上游服务可处理的上限。')
    expect(html).toContain('「上下文优化」')
    expect(html).toContain('调整上下文')
    expect(html).toContain('context_too_large · HTTP 413 · 已自动重试 2 次')
  })

  it('omits the context action when the conversation cannot open context settings', () => {
    const html = renderMessage(
      failed('对话内容超出了模型或上游服务可处理的上限。', {
        errorType: null,
        errorCode: 'context_length_exceeded',
        httpStatus: 400,
        retryCount: 0,
      }),
    )
    expect(html).not.toContain('调整上下文')
    expect(html).not.toContain('已自动重试')
  })

  it('keeps legacy failures to their saved text only', () => {
    const html = renderMessage(failed('已触发上游限流，请稍后重试。'))
    expect(html).toContain('已触发上游限流，请稍后重试。')
    expect(html).not.toContain('请稍候片刻')
    // 此断言只约束错误说明；消息时间详情也会使用分隔点连接时分秒与时区。
    const errorNotice = html.match(/data-testid="run-error-notice">([\s\S]*?)<\/div><\/div>/)?.[1]
    expect(errorNotice).toBeDefined()
    expect(errorNotice).not.toContain(' · ')
  })

  it.each([
    ['user', '这需要管理员处理，请联系管理员。'],
    ['admin', '「管理后台 → 供应商」'],
  ] as const)('tailors configuration advice for a %s', (viewerRole, hint) => {
    const html = renderMessage(
      failed('上游服务鉴权失败。', {
        errorType: 'authentication_error',
        errorCode: null,
        httpStatus: 401,
        retryCount: 0,
      }),
      { viewerRole },
    )
    expect(html).toContain(hint)
  })

  it('does not show a meaningless HTTP status for connection failures', () => {
    const html = renderMessage(
      failed('无法连接上游服务。', {
        errorType: 'network_error',
        errorCode: null,
        httpStatus: null,
        retryCount: 1,
      }),
    )
    expect(html).toContain('network_error · 已自动重试 1 次')
    expect(html).not.toContain('HTTP')
  })

  it('shows the structured live failure before the message is persisted', () => {
    const live = reduceEvent(initialLive(), {
      type: 'run.error',
      seq: 3,
      data: {
        state: 'failed',
        message: '上游服务当前负载过高。',
        detail: { errorType: 'overloaded_error', errorCode: null, httpStatus: 529, retryCount: 3 },
      },
    })
    const html = renderMessage(assistantMessage('streaming', { content: [] }), { live })
    expect(html).toContain('这通常是暂时的，请稍后重新生成。')
    expect(html).toContain('overloaded_error · HTTP 529 · 已自动重试 3 次')
  })
})

describe('assistant retry status', () => {
  const lastFailure = {
    message: '上游服务当前负载过高。',
    errorType: 'overloaded_error',
    errorCode: null,
    httpStatus: 529,
    failedAt: Date.now(),
  }

  it('tells the user why it is waiting and when the next attempt starts', () => {
    const html = renderMessage(assistantMessage('streaming', { content: [] }), {
      live: {
        ...initialLive(),
        retry: {
          phase: 'waiting',
          attempt: 2,
          maxAttempts: 6,
          nextRetryAt: lastFailure.failedAt + 5000,
          stage: 'connecting',
          lastFailure,
        },
      },
    })
    expect(html).toMatch(/生成未成功，[45] 秒后自动重试/)
    expect(html).toContain('第 1/5 次重试')
    expect(html).toContain('上游服务当前负载过高。')
    expect(html).toContain('overloaded_error · HTTP 529')
    expect(html).toContain('scaleX(')
    expect(html).not.toContain('已生成的内容会先保留')
  })

  it('keeps the previous failure visible while retrying after partial output', () => {
    const html = renderMessage(assistantMessage('streaming', { content: [] }), {
      live: {
        ...initialLive(),
        retry: {
          phase: 'attempting',
          attempt: 3,
          maxAttempts: 6,
          nextRetryAt: null,
          stage: 'after_output',
          lastFailure: {
            ...lastFailure,
            message: '与上游服务的连接在响应过程中断开。',
            httpStatus: 200,
          },
        },
      },
    })
    expect(html).toContain('正在重新生成')
    expect(html).toContain('第 2/5 次重试')
    expect(html).toContain('上次失败：与上游服务的连接在响应过程中断开。')
    expect(html).toContain('已生成的内容会先保留')
    expect(html).not.toContain('HTTP 200')
    expect(html).not.toContain('scaleX(')
  })
})
