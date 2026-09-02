import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WireEvent } from '@shared/types/events'
import { hasActiveSearch, initialLive, reduceEvent, reduceEvents } from './eventReducer'
import type { LiveMessage, LiveSearchStep } from './eventReducer'

const event = (type: string, data: Record<string, unknown> = {}): WireEvent => ({
  type,
  seq: 0,
  data,
})

const reasoningText = (live: LiveMessage): string =>
  live.processSteps
    .filter((step) => step.kind === 'reasoning')
    .map((step) => step.text)
    .filter(Boolean)
    .join('\n\n')

const lastReasoningPartKey = (live: LiveMessage): string | null =>
  live.processSteps.findLast((step) => step.kind === 'reasoning')?.partKey ?? null

const searchSteps = (live: LiveMessage): LiveSearchStep[] =>
  live.processSteps.filter((step): step is LiveSearchStep => step.kind === 'search')

const searchCalls = (live: LiveMessage) => searchSteps(live).map(({ kind: _kind, ...call }) => call)

afterEach(() => {
  vi.useRealTimers()
})

describe('reduceEvent', () => {
  it('does not start the upstream timer when the local run is created', () => {
    const next = reduceEvent(
      initialLive(null, false),
      event('run.created', { startedAt: 1000, reasoningEnabled: true }),
    )

    expect(next.reasoningEnabled).toBe(true)
    expect(next.upstreamStartedAt).toBeNull()
  })

  it('starts the upstream timer from response lifecycle events', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2000)

    const started = reduceEvent(initialLive(null, true), event('response.created'))
    expect(started.upstreamStartedAt).toBe(2000)

    vi.setSystemTime(3000)
    const repeated = reduceEvent(started, event('response.in_progress'))
    expect(repeated.upstreamStartedAt).toBe(2000)
  })

  it('uses reasoning summary deltas as a fallback upstream start marker', () => {
    vi.useFakeTimers()
    vi.setSystemTime(4000)

    const next = reduceEvent(
      initialLive(null, true),
      event('response.reasoning_summary_text.delta', { delta: 'thinking' }),
    )

    expect(reasoningText(next)).toBe('thinking')
    expect(next.upstreamStartedAt).toBe(4000)
  })

  it('preserves boundaries between structured reasoning summary parts in batched events', () => {
    const next = reduceEvents(initialLive(), [
      event('response.reasoning_summary_text.delta', {
        delta: '**Analyzing primary ',
        item_id: 'rs_1',
        output_index: 0,
        summary_index: 0,
      }),
      event('response.reasoning_summary_text.delta', {
        delta: 'requirement**',
        item_id: 'rs_1',
        output_index: 0,
        summary_index: 0,
      }),
      event('response.reasoning_summary_text.delta', {
        delta: '**Checking input constraints**',
        item_id: 'rs_1',
        output_index: 0,
        summary_index: 1,
      }),
      event('response.reasoning_summary_text.delta', {
        delta: '**Comparing candidate approaches**',
        item_id: 'rs_2',
        output_index: 1,
        summary_index: 0,
      }),
    ])

    expect(reasoningText(next)).toBe(
      [
        '**Analyzing primary requirement**',
        '**Checking input constraints**',
        '**Comparing candidate approaches**',
      ].join('\n\n'),
    )
    expect(lastReasoningPartKey(next)).toBe(JSON.stringify(['item', 'rs_2', 0]))
  })

  it('streams raw reasoning_text and preserves boundaries between reasoning items', () => {
    const next = reduceEvents(initialLive(), [
      event('response.reasoning_text.delta', {
        delta: '第一',
        item_id: 'rs_1',
        output_index: 0,
        content_index: 0,
      }),
      event('response.reasoning_text.delta', {
        delta: '段推理',
        item_id: 'rs_1',
        output_index: 0,
        content_index: 0,
      }),
      event('response.reasoning_text.delta', {
        delta: '第二段推理',
        item_id: 'rs_2',
        output_index: 2,
        content_index: 0,
      }),
    ])

    expect(reasoningText(next)).toBe('第一段推理\n\n第二段推理')
    expect(next.reasoningKind).toBe('raw')
    expect(lastReasoningPartKey(next)).toBe(JSON.stringify(['item', 'rs_2', 0]))
  })

  it('replaces streamed raw reasoning with a summary and ignores later raw deltas', () => {
    const raw = reduceEvent(
      initialLive(),
      event('response.reasoning_text.delta', {
        delta: '原始推理',
        item_id: 'rs_1',
        content_index: 0,
      }),
    )
    const emptySummary = reduceEvent(
      raw,
      event('response.reasoning_summary_text.delta', {
        delta: '',
        item_id: 'rs_1',
        summary_index: 0,
      }),
    )
    const summarized = reduceEvent(
      emptySummary,
      event('response.reasoning_summary_text.delta', {
        delta: '展示摘要',
        item_id: 'rs_1',
        summary_index: 0,
      }),
    )
    const ignoredRaw = reduceEvent(
      summarized,
      event('response.reasoning_text.delta', {
        delta: '不应重复展示',
        item_id: 'rs_1',
        content_index: 0,
      }),
    )

    expect(reasoningText(emptySummary)).toBe('原始推理')
    expect(emptySummary.reasoningKind).toBe('raw')
    expect(reasoningText(summarized)).toBe('展示摘要')
    expect(summarized.reasoningKind).toBe('summary')
    expect(reasoningText(ignoredRaw)).toBe('展示摘要')
    expect(ignoredRaw.reasoningKind).toBe('summary')
  })

  it('locks reasoning duration at answer.started rather than commentary output', () => {
    vi.useFakeTimers()
    vi.setSystemTime(4500)

    const started = reduceEvents(initialLive(1000, true), [
      event('response.output_item.added', {
        item: { type: 'message', id: 'msg_commentary', phase: 'commentary' },
      }),
      event('response.output_text.delta', { item_id: 'msg_commentary', delta: '进展' }),
    ])

    expect(started.text).toBe('')
    expect(started.processSteps).toContainEqual({
      kind: 'commentary',
      id: 'msg_commentary',
      text: '进展',
    })
    expect(started.reasoningDurationMs).toBeNull()

    const first = reduceEvent(started, event('answer.started'))

    expect(first.reasoningDurationMs).toBe(3500)

    vi.setSystemTime(9000)
    const repeated = reduceEvent(first, event('answer.started'))
    expect(repeated.reasoningDurationMs).toBe(3500)
  })

  it('moves a raw-reasoning provisional answer back into commentary when the server corrects it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(3000)

    const provisional = reduceEvents(initialLive(1000, true), [
      event('response.reasoning_text.delta', {
        item_id: 'reasoning-1',
        content_index: 0,
        delta: '原始推理',
      }),
      event('response.output_item.added', {
        item: { type: 'message', id: 'message-1', phase: 'final_answer' },
      }),
      event('answer.started', { itemId: 'message-1' }),
      event('response.output_text.delta', { item_id: 'message-1', delta: '正在核对资料。' }),
    ])
    expect(provisional.text).toBe('正在核对资料。')
    expect(provisional.answerStarted).toBe(true)
    expect(provisional.reasoningDurationMs).toBe(2000)

    const corrected = reduceEvent(
      provisional,
      event('response.output_item.reclassified', {
        itemId: 'message-1',
        phase: 'commentary',
        commentaryText: '正在核对资料。',
        answerText: '',
        annotations: [],
      }),
    )

    expect(corrected.text).toBe('')
    expect(corrected.answerStarted).toBe(false)
    expect(corrected.reasoningDurationMs).toBeNull()
    expect(corrected.processSteps).toContainEqual({
      kind: 'commentary',
      id: 'message-1',
      text: '正在核对资料。',
    })
  })

  it('starts the image timer from the image in-progress event', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)

    const started = reduceEvent(initialLive(), event('image.generation.in_progress'))
    expect(started.imageStatus).toBe('generating')
    expect(started.imageStartedAt).toBe(5000)
    expect(started.imageGenerations).toHaveLength(1)
    expect(started.imageGenerations[0]).toMatchObject({
      id: 'image-0',
      index: 0,
      status: 'generating',
      startedAt: 5000,
    })

    vi.setSystemTime(7000)
    const repeated = reduceEvent(started, event('image.generation.in_progress'))
    expect(repeated.imageStartedAt).toBe(5000)
  })

  it('tracks partial image previews without resetting the image timer', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)

    const started = reduceEvent(initialLive(), event('image.generation.in_progress'))
    vi.setSystemTime(6200)
    const preview = reduceEvent(
      started,
      event('image.generation.partial', {
        attachmentId: 'att_partial_1',
        partialIndex: 0,
      }),
    )

    expect(preview.imageStatus).toBe('generating')
    expect(preview.imagePreviewAttachmentId).toBe('att_partial_1')
    expect(preview.imagePreviewIndex).toBe(0)
    expect(preview.imagePreviewUpdatedAt).toBe(6200)
    expect(preview.imageStartedAt).toBe(5000)
    expect(preview.imageGenerations[0]).toMatchObject({
      previewAttachmentId: 'att_partial_1',
      previewIndex: 0,
      previewUpdatedAt: 6200,
      startedAt: 5000,
    })
  })

  it('promotes the completed image to the active preview', () => {
    vi.useFakeTimers()
    vi.setSystemTime(8000)

    const preview = {
      ...initialLive(0, false),
      imageStatus: 'generating' as const,
      imagePreviewAttachmentId: 'att_partial_1',
      imagePreviewIndex: 0,
      imagePreviewUpdatedAt: 6200,
      imageStartedAt: 5000,
    }
    const done = reduceEvent(
      preview,
      event('image.generation.completed', {
        attachmentId: 'att_final',
        revisedPrompt: 'clean prompt',
      }),
    )

    expect(done.imageStatus).toBe('done')
    expect(done.imageAttachmentId).toBe('att_final')
    expect(done.imagePreviewAttachmentId).toBe('att_final')
    expect(done.imageRevisedPrompt).toBe('clean prompt')
    expect(done.imagePreviewUpdatedAt).toBe(8000)
    expect(done.imageStartedAt).toBe(5000)
    expect(done.imageGenerations[0]).toMatchObject({
      attachmentId: 'att_final',
      status: 'done',
      revisedPrompt: 'clean prompt',
      startedAt: 5000,
      completedAt: 8000,
    })
  })

  it('keeps sequential multi-image partial states in separate slots', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)

    let live = reduceEvent(
      initialLive(),
      event('image.generation.in_progress', {
        generationId: 'ig_a',
        callId: 'ig_a',
        index: 0,
        outputIndex: 1,
      }),
    )
    vi.setSystemTime(2000)
    live = reduceEvent(
      live,
      event('image.generation.partial', {
        generationId: 'ig_a',
        callId: 'ig_a',
        index: 0,
        attachmentId: 'att_a_partial',
        partialIndex: 0,
      }),
    )
    vi.setSystemTime(3000)
    live = reduceEvent(
      live,
      event('image.generation.completed', {
        generationId: 'ig_a',
        callId: 'ig_a',
        index: 0,
        attachmentId: 'att_a_final',
      }),
    )
    vi.setSystemTime(4000)
    live = reduceEvent(
      live,
      event('image.generation.in_progress', {
        generationId: 'ig_b',
        callId: 'ig_b',
        index: 1,
        outputIndex: 2,
      }),
    )
    vi.setSystemTime(5000)
    live = reduceEvent(
      live,
      event('image.generation.partial', {
        generationId: 'ig_b',
        callId: 'ig_b',
        index: 1,
        attachmentId: 'att_b_partial',
        partialIndex: 1,
      }),
    )

    expect(live.imageStatus).toBe('generating')
    expect(live.imageGenerations).toHaveLength(2)
    expect(live.imageGenerations[0]).toMatchObject({
      id: 'ig_a',
      index: 0,
      status: 'done',
      attachmentId: 'att_a_final',
      startedAt: 1000,
      completedAt: 3000,
    })
    expect(live.imageGenerations[1]).toMatchObject({
      id: 'ig_b',
      index: 1,
      status: 'generating',
      previewAttachmentId: 'att_b_partial',
      previewIndex: 1,
      startedAt: 4000,
    })
    expect(live.imagePreviewAttachmentId).toBe('att_b_partial')
  })

  it('atomically replaces dirty streamed text with the final run payload', () => {
    const streamed = {
      ...initialLive(),
      text: '正文【turn5view0†L276-L',
      processSteps: [
        { kind: 'reasoning' as const, id: 'stream', text: '流式思考残片', partKey: 'stream-part' },
      ],
      annotations: [
        {
          type: 'url_citation' as const,
          url: 'https://streamed.example',
          title: '流式引用',
          start_index: 1,
          end_index: 2,
        },
      ],
    }
    const next = reduceEvent(
      streamed,
      event('run.done', {
        state: 'completed',
        text: '正文',
        processSteps: [{ kind: 'reasoning', text: '最终思考摘要' }],
        annotations: [],
      }),
    )

    expect(next).toMatchObject({
      text: '正文',
      processSteps: [
        { kind: 'reasoning', id: 'final-reasoning-0', text: '最终思考摘要', partKey: null },
      ],
      annotations: [],
      answerStarted: true,
      status: 'completed',
    })
  })

  it('clears streamed reasoning when the final payload explicitly contains null', () => {
    const streamed = {
      ...initialLive(),
      processSteps: [
        {
          kind: 'reasoning' as const,
          id: 'stream',
          text: '不应保留的流式思考',
          partKey: 'stream-part',
        },
      ],
    }
    const next = reduceEvent(
      streamed,
      event('run.done', {
        state: 'completed',
        text: '正文',
        processSteps: [],
        annotations: [],
      }),
    )

    expect(reasoningText(next)).toBe('')
    expect(lastReasoningPartKey(next)).toBeNull()
  })

  it('keeps stable final text and citation references when no correction is needed', () => {
    const annotations = [
      {
        type: 'url_citation' as const,
        url: 'https://example.com',
        title: 'Example',
        start_index: 0,
        end_index: 4,
      },
    ]
    const streamed = {
      ...initialLive(),
      text: '相同正文',
      processSteps: [
        { kind: 'reasoning' as const, id: 'stream', text: '保留流式思考', partKey: 'stream-part' },
      ],
      annotations,
    }
    const next = reduceEvent(
      streamed,
      event('run.done', { state: 'completed', text: '相同正文', annotations: [...annotations] }),
    )

    expect(next.text).toBe(streamed.text)
    expect(next.processSteps).toBe(streamed.processSteps)
    expect(next.annotations).toBe(annotations)
  })

  it('keeps streamed text when a canceled run has no final payload', () => {
    const streamed = { ...initialLive(), text: '已经生成的部分' }
    const next = reduceEvent(streamed, event('run.canceled', { state: 'canceled' }))

    expect(next.text).toBe('已经生成的部分')
    expect(next.status).toBe('canceled')
  })

  it('reduces dense streamed batches without changing append semantics', () => {
    vi.useFakeTimers()
    vi.setSystemTime(4500)

    const next = reduceEvents(initialLive(1000, true), [
      event('response.reasoning_summary_text.delta', { delta: '思考' }),
      event('response.reasoning_summary_text.delta', { delta: '中' }),
      event('answer.started'),
      event('response.output_text.delta', { delta: '答' }),
      event('response.output_text.delta', { delta: '案' }),
      event('run.done', { state: 'completed', text: '答案', annotations: [] }),
    ])

    expect(next).toMatchObject({
      text: '答案',
      reasoningDurationMs: 3500,
      status: 'completed',
    })
    expect(reasoningText(next)).toBe('思考中')
  })
})

describe('search call tracking', () => {
  it('follows the OpenAI lifecycle: query details only arrive at output_item.done', () => {
    const searching = reduceEvents(initialLive(), [
      event('response.output_item.added', {
        output_index: 1,
        item: { type: 'web_search_call', id: 'ws_1', status: 'in_progress' },
      }),
      event('response.web_search_call.in_progress', { item_id: 'ws_1' }),
      event('response.web_search_call.searching', { item_id: 'ws_1' }),
    ])
    expect(searchCalls(searching)).toEqual([{ id: 'ws_1', status: 'searching', action: null }])
    expect(hasActiveSearch(searchSteps(searching))).toBe(true)

    const done = reduceEvents(searching, [
      event('response.web_search_call.completed', { item_id: 'ws_1' }),
      event('response.output_item.done', {
        output_index: 1,
        item: {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', queries: ['react 19 发布时间'] },
        },
      }),
    ])
    expect(searchCalls(done)).toEqual([
      {
        id: 'ws_1',
        status: 'completed',
        action: { type: 'search', queries: ['react 19 发布时间'] },
      },
    ])
    expect(hasActiveSearch(searchSteps(done))).toBe(false)
  })

  it('tracks x_search custom_tool_call: type on added, query filled by input.done', () => {
    // 形状取自 api.x.ai 实测：x_search 没有专用 lifecycle 事件，
    // custom_tool_call_input.done 比 output_item.done 早到。
    const added = reduceEvents(initialLive(), [
      event('response.output_item.added', {
        output_index: 0,
        item: {
          type: 'custom_tool_call',
          id: 'ctc_1',
          call_id: 'xs_call-0',
          name: 'x_keyword_search',
          input: '',
          status: 'in_progress',
        },
      }),
    ])
    expect(searchCalls(added)).toEqual([
      { id: 'ctc_1', status: 'in_progress', action: { type: 'x_keyword_search' } },
    ])
    expect(hasActiveSearch(searchSteps(added))).toBe(true)

    const filled = reduceEvents(added, [
      event('response.custom_tool_call_input.done', {
        item_id: 'ctc_1',
        output_index: 0,
        input: '{"query":"from:elonmusk","mode":"Latest"}',
      }),
    ])
    expect(searchSteps(filled)[0]?.action).toEqual({
      type: 'x_keyword_search',
      queries: ['from:elonmusk'],
      mode: 'Latest',
    })
    // 参数已到但调用尚未结束，状态行仍是进行中
    expect(hasActiveSearch(searchSteps(filled))).toBe(true)

    const done = reduceEvents(filled, [
      event('response.output_item.done', {
        output_index: 0,
        item: {
          type: 'custom_tool_call',
          id: 'ctc_1',
          call_id: 'xs_call-0',
          name: 'x_keyword_search',
          input: '{"query":"from:elonmusk","mode":"Latest"}',
          status: 'completed',
        },
      }),
    ])
    expect(searchCalls(done)).toEqual([
      {
        id: 'ctc_1',
        status: 'completed',
        action: { type: 'x_keyword_search', queries: ['from:elonmusk'], mode: 'Latest' },
      },
    ])
  })

  it('keeps web_search and x_search in one interleaved timeline', () => {
    const state = reduceEvents(initialLive(), [
      event('response.output_item.added', {
        item: { type: 'web_search_call', id: 'ws_1', status: 'in_progress' },
      }),
      event('response.output_item.added', {
        item: {
          type: 'custom_tool_call',
          id: 'ctc_1',
          call_id: 'xs_call-0',
          name: 'x_semantic_search',
          input: '{"query":"grok 4.5"}',
          status: 'completed',
        },
      }),
      event('response.output_item.done', {
        item: {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', queries: ['grok 4.5 review'] },
        },
      }),
    ])
    expect(searchSteps(state).map((call) => call.action?.type)).toEqual([
      'search',
      'x_semantic_search',
    ])
  })

  it('ignores business custom_tool_call items that are not x_search', () => {
    const state = reduceEvents(initialLive(), [
      event('response.output_item.added', {
        item: {
          type: 'custom_tool_call',
          id: 'ctc_biz',
          call_id: 'call_biz',
          name: 'get_weather',
          input: '{"city":"OKC"}',
          status: 'completed',
        },
      }),
    ])
    expect(searchCalls(state)).toEqual([])
  })

  it('keeps discrete calls ordered and does not regress completed status on replay', () => {
    const state = reduceEvents(initialLive(), [
      event('response.output_item.added', {
        item: { type: 'web_search_call', id: 'ws_1', status: 'in_progress' },
      }),
      event('response.output_item.done', {
        item: {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', queries: ['a'] },
        },
      }),
      // 乱序/重放的进行中事件不应把已完成的调用拉回激活态
      event('response.web_search_call.in_progress', { item_id: 'ws_1' }),
      event('response.output_item.added', {
        item: { type: 'web_search_call', id: 'ws_2', status: 'in_progress' },
      }),
    ])
    expect(searchCalls(state)).toEqual([
      { id: 'ws_1', status: 'completed', action: { type: 'search', queries: ['a'] } },
      { id: 'ws_2', status: 'in_progress', action: null },
    ])
  })

  it('supports the legacy xAI shape: item already completed at added with JSON arguments', () => {
    const state = reduceEvent(
      initialLive(),
      event('response.output_item.added', {
        item: {
          type: 'web_search_call',
          id: 'fc_1',
          status: 'completed',
          name: 'web_search',
          arguments: '{"query":"what is xAI","num_results":5}',
        },
      }),
    )
    expect(searchCalls(state)).toEqual([
      { id: 'fc_1', status: 'completed', action: { type: 'search', queries: ['what is xAI'] } },
    ])
  })

  it('adopts run.done processSteps as the authoritative final list', () => {
    const streamed = reduceEvents(initialLive(), [
      event('response.output_item.added', {
        item: { type: 'web_search_call', id: 'ws_1', status: 'in_progress' },
      }),
    ])
    const next = reduceEvent(
      streamed,
      event('run.done', {
        state: 'completed',
        text: '正文',
        processSteps: [
          { kind: 'search', action: { type: 'search', queries: ['q'] } },
          { kind: 'search', action: { type: 'open_page', url: 'https://react.dev/' } },
        ],
        annotations: [],
      }),
    )
    expect(searchCalls(next)).toEqual([
      { id: 'final-search-0', status: 'completed', action: { type: 'search', queries: ['q'] } },
      {
        id: 'final-search-1',
        status: 'completed',
        action: { type: 'open_page', url: 'https://react.dev/' },
      },
    ])
  })

  it('keeps streamed call identities when run.done matches, and settles on cancel', () => {
    const doneAction = { type: 'search' as const, queries: ['a'] }
    const streamed = reduceEvents(initialLive(), [
      event('response.output_item.done', {
        item: { type: 'web_search_call', id: 'ws_1', status: 'completed', action: doneAction },
      }),
    ])
    const finished = reduceEvent(
      streamed,
      event('run.done', {
        state: 'completed',
        text: '正文',
        processSteps: [{ kind: 'search', action: doneAction }],
        annotations: [],
      }),
    )
    // 与流式解析一致时保留原行身份，避免 UI 重播入场动画
    expect(searchSteps(finished)[0]).toBe(searchSteps(streamed)[0])

    const canceled = reduceEvent(
      reduceEvents(initialLive(), [
        event('response.output_item.done', {
          item: { type: 'web_search_call', id: 'ws_1', status: 'completed', action: doneAction },
        }),
        event('response.web_search_call.searching', { item_id: 'ws_2' }),
      ]),
      event('run.canceled', { state: 'canceled' }),
    )
    // 未解析出动作的占位调用在终态被丢弃，与持久化口径一致
    expect(searchCalls(canceled)).toEqual([{ id: 'ws_1', status: 'completed', action: doneAction }])
  })

  it('仅在 run.error 明确作废部分输出时清空流式内容', () => {
    const streamed = reduceEvents(initialLive(), [
      event('response.reasoning_summary_text.delta', {
        delta: '部分思考',
        item_id: 'thinking-1',
        summary_index: 0,
      }),
      event('response.output_text.delta', { delta: '部分正文' }),
      event('response.output_text.annotation.added', {
        annotation: {
          type: 'url_citation',
          url: 'https://example.com/',
          title: 'Example',
          start_index: 0,
          end_index: 4,
        },
      }),
      event('image.generation.partial', {
        attachmentId: 'att_partial_to_discard',
        partialIndex: 0,
      }),
      event('response.output_item.done', {
        item: {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', queries: ['example'] },
        },
      }),
    ])

    const regularFailure = reduceEvent(
      streamed,
      event('run.error', { state: 'failed', message: '上游失败' }),
    )
    expect(regularFailure).toMatchObject({ text: '部分正文', status: 'failed' })
    expect(reasoningText(regularFailure)).toBe('部分思考')
    expect(regularFailure.annotations).toHaveLength(1)
    expect(searchSteps(regularFailure)).toHaveLength(1)

    const refusal = reduceEvent(
      streamed,
      event('run.error', {
        state: 'failed',
        message: '模型拒绝了此请求',
        discardPartialOutput: true,
      }),
    )
    expect(refusal).toMatchObject({
      text: '',
      processSteps: [],
      annotations: [],
      imageGenerations: [],
      imagePreviewIndex: null,
      imagePreviewUpdatedAt: null,
      imageStartedAt: null,
      status: 'failed',
      error: '模型拒绝了此请求',
    })
    expect(refusal.imageStatus).toBeUndefined()
    expect(refusal.imageAttachmentId).toBeUndefined()
    expect(refusal.imagePreviewAttachmentId).toBeUndefined()
    expect(refusal.imageRevisedPrompt).toBeUndefined()
  })
})
