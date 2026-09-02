import { describe, expect, it } from 'vitest'
import type { MessageUsage, UrlCitation } from '@shared/types/domain'
import { reasoningTextOf } from '@shared/util/processTrack'
import type { UpstreamOutputItem, UpstreamResponse } from '../provider/upstream-types'
import { reconcileFinalResponse, type StreamedResponseSnapshot } from './final-response'

const usage: MessageUsage = {
  inputTokens: 10,
  cacheWriteTokens: 1,
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
  content: [{ type: 'output_text', text: '正文【turn5view0†L276-L' }],
  processSteps: [{ kind: 'reasoning', text: '流式思考' }],
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
        input_tokens_details: { cached_tokens: 4, cache_write_tokens: 6 },
        output_tokens_details: { reasoning_tokens: 1 },
      },
    }

    expect(reconcileFinalResponse(current(), response)).toEqual({
      text: '正文',
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
      processSteps: [{ kind: 'reasoning', text: '最终思考' }],
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
        cacheWriteTokens: 6,
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

  it('按终态 output 顺序整体重建 commentary、reasoning、search 与终答 phase', () => {
    const response: UpstreamResponse = {
      output: [
        {
          type: 'message',
          phase: 'commentary',
          content: [{ type: 'output_text', text: '进展一' }],
        },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: '思考二' }] },
        {
          id: 'search-1',
          type: 'web_search_call',
          action: { type: 'search', queries: ['phase'] },
        } as UpstreamOutputItem,
        {
          type: 'message',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '终答' }],
        },
      ],
    }

    const reconciled = reconcileFinalResponse(current(), response)
    expect(reconciled.text).toBe('终答')
    expect(reconciled.content).toEqual([
      { type: 'output_text', text: '终答', phase: 'final_answer' },
    ])
    expect(reconciled.processSteps).toEqual([
      { kind: 'commentary', text: '进展一' },
      { kind: 'reasoning', text: '思考二' },
      { kind: 'search', action: { type: 'search', queries: ['phase'] } },
    ])
  })

  it('终态 output 拓扑缺项时保留完整的流式正文与过程轨', () => {
    const streamed: StreamedResponseSnapshot = {
      ...current(),
      text: '终答',
      content: [{ type: 'output_text', text: '终答', phase: 'final_answer' }],
      processSteps: [
        { kind: 'reasoning', text: '思考一' },
        { kind: 'commentary', text: '进展一' },
        { kind: 'search', action: { type: 'open_page', url: 'https://example.com' } },
      ],
      annotations: [],
    }
    const response: UpstreamResponse = {
      id: 'collapsed-response',
      output: [
        {
          id: 'reasoning-1',
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: '思考一' }],
        },
        {
          id: 'commentary-1',
          type: 'message',
          content: [{ type: 'output_text', text: '进展一终答' }],
        },
      ],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    }

    expect(
      reconcileFinalResponse(streamed, response, {
        observedOutputItemIds: [
          'reasoning-1',
          'commentary-1',
          'search-1',
          'reasoning-2',
          'final-1',
        ],
      }),
    ).toEqual({
      ...streamed,
      usage: {
        inputTokens: 20,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        outputTokens: 10,
        reasoningTokens: 0,
        totalTokens: 30,
      },
      upstreamResponseId: 'collapsed-response',
    })
  })

  it('只用流中捕获的 phase 与搜索动作补齐终态缺失字段', () => {
    const response: UpstreamResponse = {
      output: [
        {
          id: 'commentary-1',
          type: 'message',
          content: [{ type: 'output_text', text: '进展' }],
        },
        { id: 'search-1', type: 'web_search_call' } as UpstreamOutputItem,
        {
          id: 'final-1',
          type: 'message',
          content: [{ type: 'output_text', text: '终答' }],
        },
      ],
    }

    const reconciled = reconcileFinalResponse(current(), response, {
      observedOutputItemIds: ['commentary-1', 'search-1', 'final-1'],
      messagePhaseByItemId: new Map([
        ['commentary-1', 'commentary'],
        ['final-1', 'final_answer'],
      ]),
      searchActionByItemId: new Map([
        ['search-1', { type: 'open_page', url: 'https://example.com' }],
      ]),
    })

    expect(reconciled.content).toEqual([
      { type: 'output_text', text: '终答', phase: 'final_answer' },
    ])
    expect(reconciled.processSteps).toEqual([
      { kind: 'commentary', text: '进展' },
      { kind: 'search', action: { type: 'open_page', url: 'https://example.com' } },
    ])
  })

  it('以段落边界拼接多个 reasoning item 的 summary part', () => {
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
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: '**Answering**' }],
        },
      ],
    }

    expect(reasoningTextOf(reconcileFinalResponse(current(), response))).toBe(
      '**Planning**\n\n**Checking**\n\n**Answering**',
    )
  })

  it('用终态 raw reasoning_text 校准流式推理', () => {
    const response: UpstreamResponse = {
      output: [
        {
          type: 'reasoning',
          summary: [],
          content: [{ type: 'reasoning_text', text: '终态原始推理' }],
        },
      ],
    }

    expect(reasoningTextOf(reconcileFinalResponse(current(), response))).toBe('终态原始推理')
  })

  it('终态同时携带摘要与原始推理时只采用摘要', () => {
    const response: UpstreamResponse = {
      output: [
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: '终态摘要' }],
          content: [{ type: 'reasoning_text', text: '终态原始推理' }],
        },
      ],
    }

    expect(reasoningTextOf(reconcileFinalResponse(current(), response))).toBe('终态摘要')
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
