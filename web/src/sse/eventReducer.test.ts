import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WireEvent } from '@shared/types/events'
import { initialLive, reduceEvent, reduceEvents } from './eventReducer'

const event = (type: string, data: Record<string, unknown> = {}): WireEvent => ({
  type,
  seq: 0,
  data,
})

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

    expect(next.reasoning).toBe('thinking')
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

    expect(next.reasoning).toBe(
      [
        '**Analyzing primary requirement**',
        '**Checking input constraints**',
        '**Comparing candidate approaches**',
      ].join('\n\n'),
    )
    expect(next.reasoningPartKey).toBe(JSON.stringify(['item', 'rs_2', 0]))
  })

  it('locks reasoning duration when the first output text arrives', () => {
    vi.useFakeTimers()
    vi.setSystemTime(4500)

    const started = { ...initialLive(1000, true), reasoning: 'summary' }
    const first = reduceEvent(started, event('response.output_text.delta', { delta: 'Hi' }))

    expect(first.text).toBe('Hi')
    expect(first.reasoningDurationMs).toBe(3500)

    vi.setSystemTime(9000)
    const repeated = reduceEvent(first, event('response.output_text.delta', { delta: '!' }))
    expect(repeated.text).toBe('Hi!')
    expect(repeated.reasoningDurationMs).toBe(3500)
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
      reasoning: '流式思考残片',
      reasoningPartKey: 'stream-part',
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
        reasoningSummary: '最终思考摘要',
        annotations: [],
      }),
    )

    expect(next).toMatchObject({
      text: '正文',
      reasoning: '最终思考摘要',
      reasoningPartKey: null,
      annotations: [],
      status: 'completed',
      webSearching: false,
    })
  })

  it('clears streamed reasoning when the final payload explicitly contains null', () => {
    const streamed = {
      ...initialLive(),
      reasoning: '不应保留的流式思考',
      reasoningPartKey: 'stream-part',
    }
    const next = reduceEvent(
      streamed,
      event('run.done', {
        state: 'completed',
        text: '正文',
        reasoningSummary: null,
        annotations: [],
      }),
    )

    expect(next.reasoning).toBe('')
    expect(next.reasoningPartKey).toBeNull()
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
      reasoning: '保留流式思考',
      reasoningPartKey: 'stream-part',
      annotations,
    }
    const next = reduceEvent(
      streamed,
      event('run.done', { state: 'completed', text: '相同正文', annotations: [...annotations] }),
    )

    expect(next.text).toBe(streamed.text)
    expect(next.reasoning).toBe(streamed.reasoning)
    expect(next.reasoningPartKey).toBe(streamed.reasoningPartKey)
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
      event('response.output_text.delta', { delta: '答' }),
      event('response.output_text.delta', { delta: '案' }),
      event('run.done', { state: 'completed', text: '答案', annotations: [] }),
    ])

    expect(next).toMatchObject({
      reasoning: '思考中',
      text: '答案',
      reasoningDurationMs: 3500,
      status: 'completed',
    })
  })
})
