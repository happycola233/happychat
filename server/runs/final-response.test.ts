import { describe, expect, it } from 'vitest'
import type { MessageUsage, UrlCitation } from '@shared/types/domain'
import type { UpstreamResponse } from '../provider/upstream-types'
import { reconcileFinalResponse, type StreamedResponseSnapshot } from './final-response'

const usage: MessageUsage = {
  inputTokens: 10,
  cachedTokens: 2,
  outputTokens: 8,
  reasoningTokens: 3,
  totalTokens: 18,
}

const streamedCitation: UrlCitation = {
  type: 'url_citation',
  url: 'https://streamed.example',
  title: '流式引用',
  start_index: 1,
  end_index: 2,
}

const current = (): StreamedResponseSnapshot => ({
  text: '正文【turn5view0†L276-L',
  reasoningSummary: '流式思考',
  annotations: [streamedCitation],
  usage,
  upstreamResponseId: null,
})

describe('reconcileFinalResponse', () => {
  it('完成时用最终正文、引用、思考和 usage 覆盖流式累计值', () => {
    const response: UpstreamResponse = {
      id: 'resp-final',
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: '最终思考' }] },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: '正文',
              annotations: [
                {
                  type: 'url_citation',
                  url: 'https://final.example',
                  title: '最终引用',
                  start_index: 0,
                  end_index: 2,
                },
              ],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        total_tokens: 25,
        input_tokens_details: { cached_tokens: 4 },
        output_tokens_details: { reasoning_tokens: 1 },
      },
    }

    expect(reconcileFinalResponse(current(), response)).toEqual({
      text: '正文',
      reasoningSummary: '最终思考',
      annotations: [
        {
          type: 'url_citation',
          url: 'https://final.example',
          title: '最终引用',
          start_index: 0,
          end_index: 2,
        },
      ],
      usage: {
        inputTokens: 20,
        cachedTokens: 4,
        outputTokens: 5,
        reasoningTokens: 1,
        totalTokens: 25,
      },
      upstreamResponseId: 'resp-final',
    })
  })

  it('按上游顺序拼接多个最终文本部件', () => {
    const response: UpstreamResponse = {
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '第一段' }] },
        {
          type: 'message',
          content: [
            { type: 'refusal', text: '忽略' },
            { type: 'output_text', text: '第二段' },
          ],
        },
      ],
    }

    expect(reconcileFinalResponse(current(), response).text).toBe('第一段第二段')
  })

  it('不完整响应仍使用其中携带的最终部分正文', () => {
    const response: UpstreamResponse = {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', content: [{ type: 'output_text', text: '最终部分正文' }] }],
    }

    expect(reconcileFinalResponse(current(), response).text).toBe('最终部分正文')
  })

  it('中止或兼容上游未提供最终 Response 时保留 delta 累计值', () => {
    const streamed = current()
    expect(reconcileFinalResponse(streamed, undefined)).toBe(streamed)
    expect(reconcileFinalResponse(streamed, { id: 'resp-without-output' })).toEqual({
      ...streamed,
      upstreamResponseId: 'resp-without-output',
    })
  })
})
