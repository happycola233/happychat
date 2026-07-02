import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WireEvent } from '@shared/types/events'
import { initialLive, reduceEvent } from './eventReducer'

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

    vi.setSystemTime(7000)
    const repeated = reduceEvent(started, event('image.generation.in_progress'))
    expect(repeated.imageStartedAt).toBe(5000)
  })

  it('atomically replaces dirty streamed text with the final run payload', () => {
    const streamed = {
      ...initialLive(),
      text: '正文【turn5view0†L276-L',
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
        annotations: [],
      }),
    )

    expect(next).toMatchObject({
      text: '正文',
      annotations: [],
      status: 'completed',
      webSearching: false,
    })
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
    const streamed = { ...initialLive(), text: '相同正文', annotations }
    const next = reduceEvent(
      streamed,
      event('run.done', { state: 'completed', text: '相同正文', annotations: [...annotations] }),
    )

    expect(next.text).toBe(streamed.text)
    expect(next.annotations).toBe(annotations)
  })

  it('keeps streamed text when a canceled run has no final payload', () => {
    const streamed = { ...initialLive(), text: '已经生成的部分' }
    const next = reduceEvent(streamed, event('run.canceled', { state: 'canceled' }))

    expect(next.text).toBe('已经生成的部分')
    expect(next.status).toBe('canceled')
  })
})
