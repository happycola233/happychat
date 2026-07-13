import { describe, expect, it } from 'vitest'
import { buildChatBody, buildChatMessages, mapChatUsage } from './chat'
import type { BuildBodyOptions } from './params'

type ModelRow = BuildBodyOptions['model']

function model(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    id: 'model-1',
    providerId: 'provider-1',
    modelId: 'gpt-test',
    displayName: 'GPT Test',
    description: null,
    tags: null,
    kind: 'chat',
    enabled: true,
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      image_generation: false,
      reasoning: false,
    },
    defaultSystemPrompt: null,
    defaultParams: null,
    hardParams: null,
    pricing: null,
    allowedEfforts: null,
    defaultEffort: null,
    defaultWebSearch: false,
    sort: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

describe('mapChatUsage', () => {
  it('maps chat/completions usage to MessageUsage', () => {
    expect(
      mapChatUsage({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 30 },
        completion_tokens_details: { reasoning_tokens: 10 },
      }),
    ).toEqual({
      inputTokens: 100,
      cacheWriteTokens: 30,
      cachedTokens: 20,
      outputTokens: 50,
      reasoningTokens: 10,
      totalTokens: 150,
    })
  })

  it('defaults missing fields to zero', () => {
    expect(mapChatUsage(null)).toEqual({
      inputTokens: 0,
      cacheWriteTokens: 0,
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
      [
        'a1',
        {
          dataUrl: 'data:image/png;base64,xxx',
          mime: 'image/png',
          filename: 'x.png',
          kind: 'image' as const,
        },
      ],
    ])
    const msgs = buildChatMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'look' },
            { type: 'input_image', attachment_id: 'a1' },
          ],
        },
      ],
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

  it('places each virtual runtime context before its user message', () => {
    const msgs = buildChatMessages(
      [
        {
          role: 'user',
          runtimeContext: '<runtime_context>now</runtime_context>',
          content: [{ type: 'input_text', text: 'hi' }],
        },
      ],
      undefined,
      'System instructions',
    )

    expect(msgs).toEqual([
      { role: 'system', content: 'System instructions' },
      { role: 'system', content: '<runtime_context>now</runtime_context>' },
      { role: 'user', content: 'hi' },
    ])
  })
})

describe('buildChatBody', () => {
  it('falls back to a supported model default when the requested reasoning effort is unsupported', () => {
    const body = buildChatBody({
      model: model({
        capabilities: {
          vision: false,
          file_input: false,
          web_search: false,
          image_generation: false,
          reasoning: true,
        },
        allowedEfforts: ['low', 'medium'],
        defaultEffort: 'low',
      }),
      messages: [],
      userParams: { reasoning_effort: 'xhigh' },
      stream: true,
    })

    expect(body.reasoning_effort).toBe('low')
  })

  it('forwards max when the model configuration allows it', () => {
    const body = buildChatBody({
      model: model({
        capabilities: {
          vision: false,
          file_input: false,
          web_search: false,
          image_generation: false,
          reasoning: true,
        },
        allowedEfforts: [
          { value: 'xhigh', description: '超高' },
          { value: 'max', description: '极高' },
        ],
        defaultEffort: 'xhigh',
      }),
      messages: [],
      userParams: { reasoning_effort: 'max' },
      stream: true,
    })

    expect(body.reasoning_effort).toBe('max')
    expect(body.max_tokens).toBe(25_000)
  })

  it('lets advanced hard params override the generated key and pass arbitrary upstream fields', () => {
    const body = buildChatBody({
      model: model({
        hardParams: { prompt_cache_key: 'bad-key', prompt_cache_retention: 'in_memory' },
      }),
      messages: [],
      stream: true,
      promptCacheKey: 'happychat:conversation:one',
    })

    expect(body).toMatchObject({
      prompt_cache_key: 'bad-key',
      prompt_cache_retention: 'in_memory',
    })
  })

  it('does not generate prompt_cache_retention without an advanced hard param', () => {
    const body = buildChatBody({
      model: model(),
      messages: [],
      stream: true,
      promptCacheKey: 'happychat:conversation:one',
    })

    expect(body.prompt_cache_key).toBe('happychat:conversation:one')
    expect(body).not.toHaveProperty('prompt_cache_retention')
  })
})
