import { describe, expect, it } from 'vitest'
import { classifyRunError, displayableHttpStatus } from './runError'

const identity = (
  errorType: string | null,
  errorCode: string | null = null,
  httpStatus: number | null = null,
) => ({ errorType, errorCode, httpStatus })

describe('classifyRunError', () => {
  it.each([
    [identity('invalid_request_error', 'context_too_large', 413), 'context_too_large'],
    // 笼统的 invalid_request_error 不能盖过更具体的 413。
    [identity('invalid_request_error', null, 413), 'context_too_large'],
    [identity('invalid_request_error', 'context_length_exceeded', 400), 'context_too_large'],
    [identity('request_too_large', null, 200), 'context_too_large'],
    // OpenAI 余额不足以 429 返回，不能误判为限流。
    [identity('insufficient_quota', 'insufficient_quota', 429), 'billing'],
    [identity('rate_limit_error', null, 429), 'rate_limited'],
    [identity('invalid_request_error', 'invalid_image_format', 400), 'attachment_rejected'],
    [identity('refusal'), 'content_blocked'],
    [identity('first_output_timeout'), 'timeout'],
    [identity('network_error', null, null), 'network'],
    [identity('upstream_http2_stream_error', null, 200), 'network'],
    [identity('server_error', 'internal_server_error', 524), 'timeout'],
    [identity('server_error', null, 200), 'server_error'],
    [identity(null, null, 502), 'server_error'],
    [identity(null, null, 529), 'overloaded'],
    [identity('invalid_stream', 'malformed_sse_json', 200), 'invalid_response'],
    [identity('invalid_request_error', null, 400), 'invalid_request'],
    [identity('tool_use', null, 200), 'other'],
    [identity(null, null, null), 'other'],
  ] as const)('%j -> %s', (input, expected) => {
    expect(classifyRunError(input)).toBe(expected)
  })
})

describe('displayableHttpStatus', () => {
  it('只保留上游明确返回的错误状态', () => {
    expect(displayableHttpStatus(null)).toBeNull()
    expect(displayableHttpStatus(0)).toBeNull()
    expect(displayableHttpStatus(200)).toBeNull()
    expect(displayableHttpStatus(413)).toBe(413)
  })
})
