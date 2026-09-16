import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderClient } from './client'
import { buildProviderHeaders } from './request-headers'

afterEach(() => vi.unstubAllGlobals())

describe('provider request headers', () => {
  it('overrides default headers without creating differently-cased duplicates', () => {
    expect(
      buildProviderHeaders(
        'openai',
        'default-key',
        { AUTHORIZATION: 'Bearer custom-key', 'OpenAI-Project': 'project-test' },
        true,
      ),
    ).toEqual({
      authorization: 'Bearer custom-key',
      'openai-project': 'project-test',
      'content-type': 'application/json',
    })
    expect(
      buildProviderHeaders('anthropic', 'default-key', {
        'X-API-Key': 'custom-key',
        'Anthropic-Version': '2023-06-01',
        'Anthropic-Beta': 'feature-1',
      }),
    ).toMatchObject({ 'x-api-key': 'custom-key', 'anthropic-beta': 'feature-1' })
  })
  it('sends extra headers for catalog, Responses, Chat, image generation and image editing', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response('{"data":[]}', { headers: { 'Content-Type': 'application/json' } }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const client = new ProviderClient('https://example.com/v1', 'key', 'openai', undefined, {
      'X-Gateway': 'route-a',
    })
    await client.listModels()
    await client.createResponse({ model: 'test' })
    await client.createChat({ model: 'test' })
    await client.createImage({ model: 'test' })
    await client.editImage({ model: 'test' })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    for (const [, options] of fetchMock.mock.calls)
      expect(new Headers(options.headers).get('x-gateway')).toBe('route-a')
  })
  it('sends custom headers on every Anthropic catalog page and Messages request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"data":[{"id":"a"}],"has_more":true,"last_id":"a"}'))
      .mockResolvedValueOnce(new Response('{"data":[{"id":"b"}],"has_more":false}'))
      .mockResolvedValueOnce(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const client = new ProviderClient('https://example.com', 'key', 'anthropic', undefined, {
      'anthropic-beta': 'feature-a',
    })
    await client.listModels()
    await client.createAnthropicMessage({ model: 'test' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [, options] of fetchMock.mock.calls)
      expect(new Headers(options.headers).get('anthropic-beta')).toBe('feature-a')
  })
})
