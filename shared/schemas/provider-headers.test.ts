import { describe, expect, it } from 'vitest'
import { providerCreateSchema, providerUpdateSchema } from './model-config'
import { providerHeadersSchema } from './provider-headers'

describe('provider extra headers', () => {
  it('keeps custom authorization and project headers through create and update', () => {
    const extraHeaders = { Authorization: 'Bearer gateway-key', 'OpenAI-Project': 'project-demo' }
    expect(
      providerCreateSchema.parse({
        name: 'Gateway',
        baseUrl: 'https://example.com/v1',
        apiKey: 'key',
        extraHeaders,
      }).extraHeaders,
    ).toEqual(extraHeaders)
    expect(providerUpdateSchema.parse({ extraHeaders: {} }).extraHeaders).toEqual({})
  })
  it.each([
    { 'X-Trace': 'ok\r\nAuthorization: injected' },
    { 'X Trace': 'ok' },
    { 'X-Trace': 'ok', 'x-trace': 'other' },
    { Host: 'other.example.com' },
    { 'Content-Length': '0' },
    { 'Content-Type': 'text/plain' },
    { 'X-Trace': '中文' },
  ])('rejects malformed or transport-managed headers: %j', (headers) => {
    expect(providerHeadersSchema.safeParse(headers).success).toBe(false)
  })
})
