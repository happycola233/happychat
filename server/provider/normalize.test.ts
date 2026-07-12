import { describe, expect, it } from 'vitest'
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

    expect(parseResponse(response)).toMatchObject({
      text: 'answer',
      reasoningSummary: '**Planning**\n\n**Checking**\n\n**Answering**',
    })
  })
})
