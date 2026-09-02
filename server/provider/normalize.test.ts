import { describe, expect, it } from 'vitest'
import { reasoningTextOf } from '@shared/util/processTrack'
import { parseResponse } from './normalize'
import type { UpstreamResponse } from './upstream-types'

describe('parseResponse', () => {
  it('preserves every reasoning summary part as a separate Markdown paragraph', () => {
    const response: UpstreamResponse = {
      output: [
        {
          type: 'reasoning',
          summary: [
            { type: 'summary_text', text: '**Planning**' },
            { type: 'summary_text', text: '**Checking**' },
          ],
        },
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'answer' }],
        },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: '**Answering**' }],
        },
      ],
    }

    const parsed = parseResponse(response)
    expect(parsed.text).toBe('answer')
    expect(reasoningTextOf(parsed)).toBe('**Planning**\n\n**Checking**\n\n**Answering**')
  })

  it('uses raw reasoning_text when an upstream returns no summary', () => {
    const response: UpstreamResponse = {
      output: [
        {
          type: 'reasoning',
          summary: [],
          content: [{ type: 'reasoning_text', text: '第一段推理' }],
        },
        {
          type: 'reasoning',
          summary: [],
          content: [{ type: 'reasoning_text', text: '第二段推理' }],
        },
      ],
    }

    expect(reasoningTextOf(parseResponse(response))).toBe('第一段推理\n\n第二段推理')
  })

  it('prefers a reasoning summary when summary and raw text are both present', () => {
    const response: UpstreamResponse = {
      output: [
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: '可展示摘要' }],
          content: [{ type: 'reasoning_text', text: '不应重复展示的原始推理' }],
        },
      ],
    }

    expect(reasoningTextOf(parseResponse(response))).toBe('可展示摘要')
  })
})
