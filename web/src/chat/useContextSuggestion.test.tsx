import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationDTO, MessageDTO } from '@shared/types/api'
import { DEFAULT_CONTEXT_POLICY } from '@shared/util/contextPolicy'
import { useContextSuggestion } from './useContextSuggestion'

const config = { data: { enabled: true, tokenThreshold: 100000 } }
vi.mock('../hooks/useModels', () => ({ useContextOptimizationSuggestion: () => config }))
const dismissed = new Map<string, string>()
const conversation = {
  id: 'context-demo',
  contextPolicy: DEFAULT_CONTEXT_POLICY,
} as ConversationDTO
const message: MessageDTO = {
  id: 'reply',
  conversationId: conversation.id,
  parentId: null,
  role: 'assistant',
  status: 'complete',
  content: [],
  modelId: null,
  runId: null,
  processSteps: [],
  reasoningDurationMs: null,
  generationDurationMs: null,
  annotations: null,
  usage: {
    inputTokens: 100001,
    outputTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 100001,
  },
  errorMessage: null,
  createdAt: 0,
}
const messages: MessageDTO[] = [
  {
    ...message,
    id: 'prompt',
    role: 'user',
    usage: null,
    content: [{ type: 'input_image', attachment_id: 'example' }],
  },
  message,
]

function Harness({ enabled = true, current = conversation }) {
  const suggestion = useContextSuggestion(current, messages, enabled)
  return suggestion.visible ? <span>{suggestion.tokens}</span> : null
}

beforeEach(() => {
  config.data = { enabled: true, tokenThreshold: 100000 }
  dismissed.clear()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => dismissed.get(key) ?? null })
})
afterEach(() => vi.unstubAllGlobals())

describe('顶栏上下文建议', () => {
  it('只有上次实际输入严格超过阈值时才提醒，纯附件输入也能触发', () => {
    expect(renderToStaticMarkup(<Harness />)).toContain('100001')
    config.data.tokenThreshold = 100001
    expect(renderToStaticMarkup(<Harness />)).toBe('')
  })

  it('关闭全局提醒、生成中或图片模型时不展示', () => {
    expect(renderToStaticMarkup(<Harness enabled={false} />)).toBe('')
    config.data.enabled = false
    expect(renderToStaticMarkup(<Harness />)).toBe('')
  })

  it('关闭只对当前标签页中的该对话生效', () => {
    dismissed.set('happychat-context-suggestion:context-demo', '1')
    expect(renderToStaticMarkup(<Harness />)).toBe('')
    expect(
      renderToStaticMarkup(<Harness current={{ ...conversation, id: 'another-conversation' }} />),
    ).toContain('100001')
  })

  it('修改保留规则不会重新估算或篡改上次请求的真实用量', () => {
    expect(
      renderToStaticMarkup(
        <Harness
          current={{
            ...conversation,
            contextPolicy: { ...DEFAULT_CONTEXT_POLICY, historyTurns: 0 },
          }}
        />,
      ),
    ).toContain('100001')
  })
})
