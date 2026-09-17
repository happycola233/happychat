import { describe, expect, it } from 'vitest'
import type { MessageDTO } from '@shared/types/api'
import { lastRequestInputTokens } from './contextSuggestion'

describe('上下文优化建议的实际输入量', () => {
  const reply = (inputTokens: number, lastInputTokens?: number) =>
    ({
      role: 'assistant',
      status: 'complete',
      usage: { inputTokens, lastInputTokens },
    }) as MessageDTO

  it('只取当前分支最新回复，不累计历史或把输出算入上下文', () => {
    expect(lastRequestInputTokens([reply(200000), reply(1200)])).toBe(1200)
    expect(lastRequestInputTokens([reply(20), reply(120000)])).toBe(120000)
  })

  it('续跑和重试按最后一次输入，保留旧消息用量兼容', () => {
    expect(lastRequestInputTokens([reply(250000, 60000)])).toBe(60000)
    expect(lastRequestInputTokens([reply(123456)])).toBe(123456)
  })

  it('没有用量或尚未完成时不回退到旧回复或文字估算', () => {
    expect(lastRequestInputTokens([])).toBeNull()
    expect(lastRequestInputTokens([reply(200000), { ...reply(0), usage: null }])).toBeNull()
    expect(lastRequestInputTokens([{ ...reply(200000), status: 'streaming' }])).toBeNull()
  })
})
