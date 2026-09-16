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
const messages = [
  { role: 'user', content: [{ type: 'input_text', text: '文'.repeat(100000) }] },
] as MessageDTO[]

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
  it('仅在保留文字达到配置阈值时展示估算量', () => {
    expect(renderToStaticMarkup(<Harness />)).toContain('100000')
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
    ).toContain('100000')
  })

  it('减少上下文后不再提示', () => {
    expect(
      renderToStaticMarkup(
        <Harness
          current={{
            ...conversation,
            contextPolicy: { ...DEFAULT_CONTEXT_POLICY, historyTurns: 0 },
          }}
        />,
      ),
    ).toBe('')
  })
})
