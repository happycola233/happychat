import { describe, expect, it, vi } from 'vitest'
import {
  buildChatBody,
  buildChatMessages,
  mapChatUsage,
  parseChatStream,
  type ChatStreamEvent,
} from './chat'
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
    icon: null,
    groupId: null,
    kind: 'chat',
    enabled: true,
    accessMode: 'all',
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
    },
    defaultSystemPrompt: null,
    defaultParams: null,
    hardParams: null,
    pricing: null,
    allowedEfforts: null,
    defaultEffort: null,
    replayProviderContext: false,
    defaultWebSearch: false,
    defaultXSearch: false,
    sort: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      const firstBoundary = Math.floor(bytes.length / 3)
      const secondBoundary = Math.floor((bytes.length * 2) / 3)
      controller.enqueue(bytes.slice(0, firstBoundary))
      controller.enqueue(bytes.slice(firstBoundary, secondBoundary))
      controller.enqueue(bytes.slice(secondBoundary))
      controller.close()
    },
  })
}

async function collectChatEvents(text: string): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const event of parseChatStream(streamOf(text))) events.push(event)
  return events
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

describe('parseChatStream', () => {
  it('emits chunk and done events across byte boundaries', async () => {
    const chunk = {
      id: 'chatcmpl-test',
      choices: [{ delta: { content: '你好' }, finish_reason: null }],
    }
    const events = await collectChatEvents(
      `data: ${JSON.stringify(chunk)}\r\n\r\ndata: [DONE]\r\n\r\n`,
    )

    expect(events).toEqual([{ type: 'chunk', chunk }, { type: 'done' }])
  })

  it('does not invent a terminal event when the stream reaches EOF early', async () => {
    const chunk = {
      id: 'chatcmpl-test',
      choices: [{ delta: { content: 'partial' }, finish_reason: null }],
    }

    await expect(collectChatEvents(`data: ${JSON.stringify(chunk)}\n\n`)).resolves.toEqual([
      { type: 'chunk', chunk },
    ])
  })

  it('rejects a malformed non-empty JSON data frame instead of dropping it', async () => {
    await expect(collectChatEvents('data: {"choices":\n\n')).rejects.toMatchObject({
      name: 'UpstreamError',
      type: 'invalid_stream',
    })
  })

  it('cancels the unread response body after a malformed frame', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":\n\n'))
      },
      cancel,
    })

    const collect = async () => {
      for await (const _event of parseChatStream(stream)) {
        // 畸形首帧不会产出事件。
      }
    }

    await expect(collect()).rejects.toMatchObject({ type: 'invalid_stream' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects an HTTP 200 upstream error frame and preserves its metadata', async () => {
    const frame = {
      error: {
        message: 'stream exploded',
        type: 'server_error',
        code: 'stream_failed',
      },
    }

    await expect(
      collectChatEvents(`event: error\ndata: ${JSON.stringify(frame)}\n\n`),
    ).rejects.toMatchObject({
      name: 'UpstreamError',
      message: expect.stringContaining('stream exploded'),
      type: 'server_error',
      code: 'stream_failed',
    })
  })

  it('rejects a top-level SSE error event instead of treating a following done marker as success', async () => {
    const frame = {
      message: 'top-level stream error',
      type: 'server_error',
      code: 'top_level_failed',
    }

    await expect(
      collectChatEvents(`event: error\ndata: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`),
    ).rejects.toMatchObject({
      name: 'UpstreamError',
      message: expect.stringContaining('top-level stream error'),
      type: 'server_error',
      code: 'top_level_failed',
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

  it('prepends commentary to the assistant answer without leaking phase fields', () => {
    const messages = buildChatMessages(
      [
        {
          role: 'assistant',
          processSteps: [
            { kind: 'commentary', text: '先核对资料。' },
            { kind: 'commentary', text: '再确认结论。' },
          ],
          content: [{ type: 'output_text', text: '最终回答', phase: 'final_answer' }],
        },
      ],
      undefined,
      null,
    )

    expect(messages).toEqual([
      { role: 'assistant', content: '先核对资料。\n\n再确认结论。\n\n最终回答' },
    ])
    expect(JSON.stringify(messages)).not.toContain('phase')
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

  it('maps user files to the official chat/completions file content part', () => {
    const atts = new Map([
      [
        'file-1',
        {
          dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
          mime: 'application/pdf',
          filename: 'report.pdf',
          kind: 'file' as const,
        },
      ],
    ])

    const msgs = buildChatMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '总结这个文件' },
            { type: 'input_file', attachment_id: 'file-1', filename: 'report.pdf' },
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
          { type: 'text', text: '总结这个文件' },
          {
            type: 'file',
            file: {
              file_data: 'data:application/pdf;base64,JVBERi0xLjQ=',
              filename: 'report.pdf',
            },
          },
        ],
      },
    ])
  })

  it('keeps a file-only user message non-empty', () => {
    const atts = new Map([
      [
        'file-1',
        {
          dataUrl: 'data:text/plain;base64,aGVsbG8=',
          mime: 'text/plain',
          filename: 'notes.txt',
          kind: 'file' as const,
        },
      ],
    ])

    const msgs = buildChatMessages(
      [
        {
          role: 'user',
          content: [{ type: 'input_file', attachment_id: 'file-1', filename: 'notes.txt' }],
        },
      ],
      atts,
      null,
    )

    expect(msgs).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            file: {
              file_data: 'data:text/plain;base64,aGVsbG8=',
              filename: 'notes.txt',
            },
          },
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
          x_search: false,
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
          x_search: false,
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
    expect(body.max_completion_tokens).toBe(25_000)
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('maps the configured output limit to max_completion_tokens', () => {
    const body = buildChatBody({
      model: model({
        defaultParams: { max_output_tokens: 4096 },
      }),
      messages: [],
      stream: false,
    })

    expect(body.max_completion_tokens).toBe(4096)
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('migrates a legacy hard max_tokens override without sending both fields', () => {
    const legacyBody = buildChatBody({
      model: model({ hardParams: { max_tokens: 2048 } }),
      messages: [],
      stream: false,
    })
    const explicitBody = buildChatBody({
      model: model({ hardParams: { max_tokens: 2048, max_completion_tokens: 4096 } }),
      messages: [],
      stream: false,
    })

    expect(legacyBody.max_completion_tokens).toBe(2048)
    expect(legacyBody).not.toHaveProperty('max_tokens')
    expect(explicitBody.max_completion_tokens).toBe(4096)
    expect(explicitBody).not.toHaveProperty('max_tokens')
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
