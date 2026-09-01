import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderClient } from './client'
import { UpstreamResponseLatencyTracker } from './response-timing'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ProviderClient / response timing', () => {
  it.each(['openai', 'anthropic'] as const)(
    'records %s POST time through response headers',
    async (protocol) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ status: 'completed', output: [], content: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_425)
      const responseTiming = new UpstreamResponseLatencyTracker()
      const client = new ProviderClient(
        'https://api.example.com/v1',
        'test-key',
        protocol,
        responseTiming,
      )

      if (protocol === 'anthropic') {
        await client.createAnthropicMessage({ model: 'claude-test', messages: [], max_tokens: 1 })
      } else {
        await client.createResponse({ model: 'gpt-test', input: 'hello' })
      }

      expect(responseTiming.latencyMs).toBe(425)
    },
  )
})

describe('ProviderClient / Anthropic', () => {
  it('使用原生 headers 与分页 /v1/models，且兼容根 Base URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'claude-a',
                max_tokens: 4096,
                capabilities: {
                  thinking: {
                    supported: true,
                    types: { adaptive: { supported: true } },
                  },
                },
              },
            ],
            has_more: true,
            last_id: 'claude-a',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'claude-b' }], has_more: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ProviderClient('https://api.anthropic.com', 'test-key', 'anthropic')
    await expect(client.listModels()).resolves.toEqual([
      {
        id: 'claude-a',
        max_tokens: 4096,
        capabilities: {
          thinking: {
            supported: true,
            types: { adaptive: { supported: true } },
          },
        },
      },
      { id: 'claude-b' },
    ])

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.anthropic.com/v1/models?limit=100',
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.anthropic.com/v1/models?limit=100&after_id=claude-a',
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers).toMatchObject({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
    })
    expect(headers).not.toHaveProperty('Authorization')
  })

  it('向已含 /v1 的网关发送 /messages，不产生重复版本路径', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ProviderClient('https://gateway.example.com/v1/', 'test-key', 'anthropic')
    await client.createAnthropicMessage({ model: 'claude-sonnet-5', messages: [], max_tokens: 1 })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://gateway.example.com/v1/messages')
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 1,
      stream: false,
    })
  })

  it('按最终序列化 JSON 精确拒绝超过 32MB 的 Messages 请求', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const client = new ProviderClient('https://api.anthropic.com', 'test-key', 'anthropic')

    await expect(
      client.createAnthropicMessage({
        model: 'claude-sonnet-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'x'.repeat(32 * 1024 * 1024) }],
      }),
    ).rejects.toMatchObject({ status: 413, type: 'request_too_large' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
