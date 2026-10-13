import { describe, expect, it } from 'vitest'
import { friendlyUpstreamMessage, networkError, toUpstreamError } from './errors'

const timeoutHtml = '<!DOCTYPE html><html><title>524: A timeout occurred</title></html>'
const nginx413Html =
  '<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n' +
  '<center><h1>413 Request Entity Too Large</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>'

describe('上游错误提示与诊断原文', () => {
  it.each(['html', 'json'] as const)(
    'HTTP 524 的 %s 错误页显示超时原因并保留原文',
    async (format) => {
      const response = new Response(
        format === 'html'
          ? timeoutHtml
          : JSON.stringify({
              error: { type: 'server_error', code: 'internal_server_error', message: timeoutHtml },
            }),
        {
          status: 524,
          headers: {
            'Content-Type': format === 'html' ? 'text/html' : 'application/json',
            'Retry-After': '5',
          },
        },
      )
      const error = await toUpstreamError(response)
      expect(error).toMatchObject({
        status: 524,
        message: '上游服务响应超时（HTTP 524）。',
        rawMessage: timeoutHtml,
        retryAfterMs: 5000,
      })
      expect(error.type).toBe(format === 'json' ? 'server_error' : undefined)
      expect(error.code).toBe(format === 'json' ? 'internal_server_error' : undefined)
    },
  )

  it('网关把 413 HTML 包装成参数错误时，按错误码说明上下文过大', async () => {
    const error = await toUpstreamError(
      new Response(
        JSON.stringify({
          error: {
            type: 'invalid_request_error',
            code: 'context_too_large',
            message: nginx413Html,
          },
        }),
        { status: 413 },
      ),
    )
    expect(error.message).toBe('对话内容超出了模型或上游服务可处理的上限。')
    expect(error.rawMessage).toBe(nginx413Html)
  })

  it.each([
    [{ type: 'invalid_request_error', status: 413 }, '对话内容超出了模型或上游服务可处理的上限。'],
    [
      { type: 'invalid_request_error', code: 'context_length_exceeded', status: 400 },
      '对话内容超出了模型或上游服务可处理的上限。',
    ],
    [{ type: 'request_too_large', status: 200 }, '对话内容超出了模型或上游服务可处理的上限。'],
    [{ type: 'insufficient_quota', status: 429 }, '上游账户的余额、额度或支出上限不足。'],
    [{ type: 'rate_limit_error', status: 429 }, '上游请求过于频繁，已被暂时限流。'],
    [{ type: 'permission_error', status: 403 }, '上游服务拒绝访问当前模型或资源。'],
    [{ status: 401 }, '上游服务鉴权失败。'],
    [{ code: 'model_not_found', status: 404 }, '上游找不到当前模型或接口。'],
    [{ type: 'overloaded_error', status: 529 }, '上游服务当前负载过高。'],
    [{ code: 'invalid_image_format', status: 200 }, '上游无法处理本次附带的图片。'],
  ])('按结构化 type/code 与状态归类：%j', (input, expected) => {
    expect(friendlyUpstreamMessage({ rawMessage: 'Rate limit for org-secret', ...input })).toBe(
      expected,
    )
  })

  it('服务端、鉴权、计费与限流错误不引用上游原文', () => {
    for (const input of [
      { type: 'server_error', status: 502 },
      { type: 'authentication_error', status: 401 },
      { type: 'billing_error', status: 402 },
      { code: 'rate_limit_exceeded', status: 200 },
    ]) {
      expect(
        friendlyUpstreamMessage({ ...input, rawMessage: 'dial tcp 10.0.0.5:443 org-secret' }),
      ).not.toMatch(/10\.0\.0\.5|org-secret/)
    }
    expect(friendlyUpstreamMessage({ type: 'server_error', status: 502 })).toBe(
      '上游服务暂时不可用（HTTP 502）。',
    )
    // 笼统的 server_error 不盖过更具体的 503。
    expect(friendlyUpstreamMessage({ type: 'server_error', status: 503 })).toBe(
      '上游服务当前负载过高。',
    )
  })

  it('参数错误引用折叠空白、限长的原文，HTML 原文不进入提示', () => {
    expect(
      friendlyUpstreamMessage({
        type: 'invalid_request_error',
        rawMessage: 'Unknown parameter:\n  example',
        status: 400,
      }),
    ).toBe('上游不接受本次请求：Unknown parameter: example')
    const long = friendlyUpstreamMessage({
      type: 'invalid_request_error',
      rawMessage: 'x'.repeat(5000),
      status: 400,
    })
    expect(long).toHaveLength('上游不接受本次请求：'.length + 301)
    expect(long.endsWith('…')).toBe(true)
    expect(
      friendlyUpstreamMessage({
        type: 'invalid_request_error',
        rawMessage: timeoutHtml,
        status: 400,
      }),
    ).toBe('上游不接受本次请求的参数。')
  })

  it('无法归类的流内错误仍显示原文，没有原文时不显示 HTTP 200', () => {
    expect(
      friendlyUpstreamMessage({
        type: 'vector_store_timeout',
        rawMessage: 'Store busy',
        status: 200,
      }),
    ).toBe('Store busy')
    expect(friendlyUpstreamMessage({ type: 'mystery', status: 200 })).toBe('上游请求失败。')
  })

  it('纯文本错误保留诊断信息，空正文仍显示状态码', async () => {
    const textError = await toUpstreamError(new Response('Gateway unavailable', { status: 502 }))
    expect(textError).toMatchObject({
      message: '上游服务暂时不可用（HTTP 502）。',
      rawMessage: 'Gateway unavailable',
    })
    expect((await toUpstreamError(new Response(null, { status: 524 }))).message).toBe(
      '上游服务响应超时（HTTP 524）。',
    )
  })

  it('网络错误不向用户展示主机地址，底层原因只进入诊断原文', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:443'), {
      code: 'ECONNREFUSED',
    })
    const error = networkError(new TypeError('fetch failed', { cause }))
    expect(error).toMatchObject({
      message: '无法连接上游服务。',
      status: 0,
      type: 'network_error',
      rawMessage: 'fetch failed（ECONNREFUSED: connect ECONNREFUSED 10.0.0.5:443）',
    })
    expect(networkError(new TypeError('terminated'), 'response').message).toBe(
      '与上游服务的连接在响应过程中断开。',
    )
  })
})
