import { describe, expect, it } from 'vitest'
import { buildChatMessages, mapChatUsage } from './chat'

describe('mapChatUsage', () => {
  it('maps chat/completions usage to MessageUsage', () => {
    expect(
      mapChatUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 10 },
      }),
    ).toEqual({
      inputTokens: 100,
      cachedTokens: 20,
      outputTokens: 50,
      reasoningTokens: 10,
      totalTokens: 150,
    })
  })

  it('defaults missing fields to zero', () => {
    expect(mapChatUsage(null)).toEqual({
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    })
  })
})

describe('buildChatMessages', () => {
  it('maps system + user text + assistant text', () => {
    const msgs = buildChatMessages(
      [
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
      ],
      undefined,
      'You are helpful',
    )
    expect(msgs).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('uses multimodal content when a user message has images', () => {
    const atts = new Map([
      ['a1', { dataUrl: 'data:image/png;base64,xxx', mime: 'image/png', filename: 'x.png', kind: 'image' as const }],
    ])
    const msgs = buildChatMessages(
      [{ role: 'user', content: [{ type: 'input_text', text: 'look' }, { type: 'input_image', attachment_id: 'a1' }] }],
      atts,
      null,
    )
    expect(msgs).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,xxx' } },
        ],
      },
    ])
  })
})
