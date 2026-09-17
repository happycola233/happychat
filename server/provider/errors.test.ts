import { describe, expect, it } from 'vitest'
import { friendlyUpstreamMessage, toUpstreamError } from './errors'

const timeoutHtml = '<!DOCTYPE html><html><title>524: A timeout occurred</title></html>'

describe('上游错误提示与诊断原文', () => {
  it.each(['html', 'json'] as const)(
    'HTTP 524 的 %s 错误页显示超时提示并保留原文',
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
        message: '上游服务响应超时（HTTP 524），请稍后重试。',
        rawMessage: timeoutHtml,
        retryAfterMs: 5000,
      })
      expect(error.type).toBe(format === 'json' ? 'server_error' : undefined)
      expect(error.code).toBe(format === 'json' ? 'internal_server_error' : undefined)
    },
  )

  it('其他服务端错误同样隐藏 HTML，但保留普通错误描述', () => {
    expect(friendlyUpstreamMessage('server_error', timeoutHtml, 502)).toBe(
      '上游服务返回错误（HTTP 502）。',
    )
    expect(friendlyUpstreamMessage('server_error', 'Temporary overload', 503)).toBe(
      '上游服务返回错误：Temporary overload',
    )
    expect(
      friendlyUpstreamMessage('invalid_request_error', 'Unknown parameter: example', 400),
    ).toBe('请求参数有误：Unknown parameter: example')
  })

  it('纯文本错误保留诊断信息，空正文仍显示状态码', async () => {
    const textError = await toUpstreamError(new Response('Gateway unavailable', { status: 502 }))
    expect(textError).toMatchObject({
      message: '上游服务暂时不可用（HTTP 502）。',
      rawMessage: 'Gateway unavailable',
    })
    expect((await toUpstreamError(new Response(null, { status: 524 }))).message).toContain(
      '上游服务响应超时（HTTP 524）',
    )
  })
})
