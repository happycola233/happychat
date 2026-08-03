import { describe, expect, it } from 'vitest'
import { AnthropicStreamAccumulator } from './anthropic-stream'
import { UpstreamError } from './errors'
import type { StreamEvent } from './sse-parse'

function event(type: string, data: Record<string, unknown> = {}): StreamEvent {
  return { type, data: { type, ...data } }
}

describe('AnthropicStreamAccumulator', () => {
  it('按 index 保留 thinking 签名、搜索密文、文本引用与累计 usage', () => {
    const accumulator = new AnthropicStreamAccumulator()
    const effects = [
      ...accumulator.accept(
        event('message_start', {
          message: {
            id: 'msg_1',
            usage: { input_tokens: 5, cache_read_input_tokens: 7, output_tokens: 1 },
          },
        }),
      ),
      ...accumulator.accept(
        event('content_block_start', {
          index: 0,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }),
      ),
      ...accumulator.accept(
        event('content_block_delta', {
          index: 0,
          delta: { type: 'thinking_delta', thinking: '推理摘要' },
        }),
      ),
      ...accumulator.accept(
        event('content_block_delta', {
          index: 0,
          delta: { type: 'signature_delta', signature: 'opaque-signature' },
        }),
      ),
      ...accumulator.accept(event('content_block_stop', { index: 0 })),
      ...accumulator.accept(
        event('content_block_start', {
          index: 1,
          content_block: {
            type: 'server_tool_use',
            id: 'srv_1',
            name: 'web_search',
            input: {},
          },
        }),
      ),
      ...accumulator.accept(
        event('content_block_delta', {
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"query":"Anthropic API"}' },
        }),
      ),
      ...accumulator.accept(event('content_block_stop', { index: 1 })),
      ...accumulator.accept(
        event('content_block_start', {
          index: 2,
          content_block: {
            type: 'web_search_tool_result',
            tool_use_id: 'srv_1',
            content: [
              {
                type: 'web_search_result',
                url: 'https://example.com',
                encrypted_content: 'opaque-result',
              },
            ],
          },
        }),
      ),
      ...accumulator.accept(event('content_block_stop', { index: 2 })),
      ...accumulator.accept(
        event('content_block_start', {
          index: 3,
          content_block: { type: 'text', text: '' },
        }),
      ),
      ...accumulator.accept(
        event('content_block_delta', {
          index: 3,
          delta: { type: 'text_delta', text: '答案' },
        }),
      ),
      ...accumulator.accept(
        event('content_block_delta', {
          index: 3,
          delta: {
            type: 'citations_delta',
            citation: {
              type: 'web_search_result_location',
              url: 'https://example.com',
              title: 'Example',
              encrypted_index: 'opaque-index',
            },
          },
        }),
      ),
      ...accumulator.accept(event('content_block_stop', { index: 3 })),
      ...accumulator.accept(
        event('message_delta', {
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 8 } },
        }),
      ),
      ...accumulator.accept(event('message_stop')),
    ]

    expect(effects).toEqual(
      expect.arrayContaining([
        { type: 'thinking', index: 0, delta: '推理摘要' },
        { type: 'web_search_start', index: 1, id: 'srv_1' },
        {
          type: 'web_search_input',
          index: 1,
          id: 'srv_1',
          input: { query: 'Anthropic API' },
        },
        { type: 'web_search_result', index: 2, toolUseId: 'srv_1' },
        { type: 'text', index: 3, delta: '答案' },
      ]),
    )
    expect(effects.find((effect) => effect.type === 'citation')).toMatchObject({
      start: 0,
      end: 2,
    })
    expect(accumulator.usage).toMatchObject({
      input_tokens: 5,
      cache_read_input_tokens: 7,
      output_tokens: 20,
      output_tokens_details: { thinking_tokens: 8 },
    })
    expect(accumulator.stopReason).toBe('end_turn')
    expect(accumulator.messageId).toBe('msg_1')
    expect(accumulator.finish()).toEqual([
      { type: 'thinking', thinking: '推理摘要', signature: 'opaque-signature' },
      {
        type: 'server_tool_use',
        id: 'srv_1',
        name: 'web_search',
        input: { query: 'Anthropic API' },
      },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srv_1',
        content: [
          {
            type: 'web_search_result',
            url: 'https://example.com',
            encrypted_content: 'opaque-result',
          },
        ],
      },
      {
        type: 'text',
        text: '答案',
        citations: [
          {
            type: 'web_search_result_location',
            url: 'https://example.com',
            title: 'Example',
            encrypted_index: 'opaque-index',
          },
        ],
      },
    ])
  })

  it('兼容在完整 message_delta 后省略 message_stop 的网关', () => {
    const accumulator = new AnthropicStreamAccumulator()
    accumulator.accept(
      event('content_block_start', {
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
    )
    accumulator.accept(
      event('content_block_delta', {
        index: 0,
        delta: { type: 'text_delta', text: '完成' },
      }),
    )
    accumulator.accept(event('content_block_stop', { index: 0 }))
    accumulator.accept(
      event('message_delta', {
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 1 },
      }),
    )

    expect(accumulator.finish()).toEqual([{ type: 'text', text: '完成' }])
  })

  it('缺少终止原因或仍有未关闭 block 时继续拒绝不完整流', () => {
    const accumulator = new AnthropicStreamAccumulator()
    expect(() => accumulator.finish()).toThrow('message_stop')

    accumulator.accept(
      event('content_block_start', {
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
    )
    accumulator.accept(event('message_delta', { delta: { stop_reason: 'end_turn' } }))
    expect(() => accumulator.finish()).toThrow('content_block_stop')
  })

  it('即使收到 message_stop 也拒绝仍有未关闭 block 的流', () => {
    const accumulator = new AnthropicStreamAccumulator()
    accumulator.accept(
      event('content_block_start', {
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
    )
    accumulator.accept(event('message_stop', {}))

    expect(() => accumulator.finish()).toThrow('content_block_stop')
  })

  it('从 HTTP 200 的搜索结果 block 提取业务错误码', () => {
    const accumulator = new AnthropicStreamAccumulator()
    expect(
      accumulator.accept(
        event('content_block_start', {
          index: 0,
          content_block: {
            type: 'web_search_tool_result',
            tool_use_id: 'srv_failed',
            content: {
              type: 'web_search_tool_result_error',
              error_code: 'max_uses_exceeded',
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: 'web_search_result',
        index: 0,
        toolUseId: 'srv_failed',
        errorCode: 'max_uses_exceeded',
      },
    ])
  })

  it('把流内 error 归一为带类型和友好文案的 UpstreamError', () => {
    const accumulator = new AnthropicStreamAccumulator()
    let thrown: unknown
    try {
      accumulator.accept(
        event('error', {
          error: { type: 'overloaded_error', message: 'Overloaded' },
        }),
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(UpstreamError)
    expect(thrown).toMatchObject({
      message: 'Anthropic 上游当前过载，请稍后重试。',
      status: 529,
      type: 'overloaded_error',
      rawMessage: 'Overloaded',
    })
  })

  it.each([
    ['invalid_request_error', 400],
    ['authentication_error', 401],
    ['billing_error', 402],
    ['permission_error', 403],
    ['not_found_error', 404],
    ['conflict_error', 409],
    ['request_too_large', 413],
    ['rate_limit_error', 429],
    ['api_error', 500],
    ['timeout_error', 504],
    ['overloaded_error', 529],
    ['future_error_type', 500],
  ])('流内 %s 映射为 HTTP %i', (type, expectedStatus) => {
    const accumulator = new AnthropicStreamAccumulator()
    let thrown: unknown
    try {
      accumulator.accept(
        event('error', {
          error: { type, message: 'raw upstream message' },
        }),
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(UpstreamError)
    expect(thrown).toMatchObject({ type, status: expectedStatus })
  })
})
