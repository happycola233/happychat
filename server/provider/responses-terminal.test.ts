import { describe, expect, it } from 'vitest'
import type { UpstreamResponse } from './upstream-types'
import { classifyResponsesTerminal } from './responses-terminal'

describe('classifyResponsesTerminal', () => {
  it('把 completed 中的结构化 refusal 归为失败并作废部分输出', () => {
    expect(
      classifyResponsesTerminal({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal' }] }],
      }),
    ).toEqual({
      state: 'failed',
      incompleteReason: null,
      errorType: 'refusal',
      errorCode: null,
      discardPartialOutput: true,
    })
  })

  it('兼容流中已见 refusal、终态 output 未回填的网关', () => {
    expect(
      classifyResponsesTerminal(
        { status: 'completed', output: [] },
        { eventState: 'completed', refusalObserved: true },
      ),
    ).toMatchObject({ state: 'failed', errorType: 'refusal', discardPartialOutput: true })
  })

  it('把 content_filter 截断归为失败并作废部分输出', () => {
    expect(
      classifyResponsesTerminal({
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
      }),
    ).toEqual({
      state: 'failed',
      incompleteReason: null,
      errorType: 'content_filter',
      errorCode: null,
      discardPartialOutput: true,
    })
  })

  it('普通输出上限截断仍保留为 incomplete', () => {
    expect(
      classifyResponsesTerminal({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
    ).toEqual({
      state: 'incomplete',
      incompleteReason: 'max_output_tokens',
      errorType: null,
      errorCode: null,
      discardPartialOutput: false,
    })
  })

  it('response.failed 保留上游错误代码', () => {
    const response: UpstreamResponse = {
      status: 'failed',
      error: { code: 'server_error', message: 'upstream failed' },
    }

    expect(classifyResponsesTerminal(response)).toEqual({
      state: 'failed',
      incompleteReason: null,
      errorType: 'server_error',
      errorCode: 'server_error',
      discardPartialOutput: false,
    })
  })

  it('流式事件状态可补齐兼容网关缺失的 status', () => {
    expect(classifyResponsesTerminal({}, { eventState: 'failed' })).toEqual({
      state: 'failed',
      incompleteReason: null,
      errorType: 'response_failed',
      errorCode: null,
      discardPartialOutput: false,
    })
  })

  it('非流式响应缺少 status 时不猜测为完成', () => {
    expect(classifyResponsesTerminal({ output: [] })).toEqual({
      state: 'failed',
      incompleteReason: null,
      errorType: 'invalid_response',
      errorCode: null,
      discardPartialOutput: false,
    })
  })
})
