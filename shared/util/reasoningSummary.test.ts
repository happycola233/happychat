import { describe, expect, it } from 'vitest'
import {
  appendReasoningSummaryDelta,
  appendReasoningTextDelta,
  joinReasoningSummaryParts,
  reasoningSummaryPartKey,
  reasoningTextPartKey,
  responseDeltaIdentityKey,
} from './reasoningSummary'

describe('reasoning summary parts', () => {
  it('joins independent parts with one Markdown paragraph boundary', () => {
    expect(joinReasoningSummaryParts(['**First**', '**Second**', '**Third**'])).toBe(
      '**First**\n\n**Second**\n\n**Third**',
    )
  })

  it('does not duplicate newlines already supplied by an upstream part', () => {
    expect(joinReasoningSummaryParts(['First\n', '\nSecond', '', 'Third'])).toBe(
      'First\n\nSecond\n\nThird',
    )
  })

  it('preserves extra upstream newlines without adding another boundary', () => {
    expect(joinReasoningSummaryParts(['First\n\n', '\n\nSecond'])).toBe('First\n\n\n\nSecond')
  })

  it('keeps token deltas together inside a part and separates a new summary index', () => {
    const first = appendReasoningSummaryDelta(
      { text: '', partKey: null },
      { item_id: 'rs_1', output_index: 0, summary_index: 0, delta: '**Plan' },
    )
    const continued = appendReasoningSummaryDelta(first, {
      item_id: 'rs_1',
      output_index: 0,
      summary_index: 0,
      delta: 'ning**',
    })
    const nextPart = appendReasoningSummaryDelta(continued, {
      item_id: 'rs_1',
      output_index: 0,
      summary_index: 1,
      delta: '**Checking**',
    })

    expect(nextPart).toEqual({
      text: '**Planning**\n\n**Checking**',
      partKey: reasoningSummaryPartKey({ item_id: 'rs_1', output_index: 0, summary_index: 1 }),
    })
  })

  it('keeps chat/completions reasoning deltas contiguous when part identity is absent', () => {
    const first = appendReasoningSummaryDelta({ text: '', partKey: null }, { delta: '思考' })
    expect(appendReasoningSummaryDelta(first, { delta: '中' })).toEqual({
      text: '思考中',
      partKey: null,
    })
  })

  it('does not consume a new part boundary when an empty delta arrives first', () => {
    const first = appendReasoningSummaryDelta(
      { text: '', partKey: null },
      { item_id: 'rs_1', output_index: 0, summary_index: 0, delta: '**First**' },
    )
    const empty = appendReasoningSummaryDelta(first, {
      item_id: 'rs_1',
      output_index: 0,
      summary_index: 1,
      delta: '',
    })
    const second = appendReasoningSummaryDelta(empty, {
      item_id: 'rs_1',
      output_index: 0,
      summary_index: 1,
      delta: '**Second**',
    })

    expect(empty).toBe(first)
    expect(second.text).toBe('**First**\n\n**Second**')
  })

  it('keeps a part stable when a compatible upstream omits redundant output_index', () => {
    const first = appendReasoningSummaryDelta(
      { text: '', partKey: null },
      { item_id: 'rs_1', output_index: 0, summary_index: 0, delta: '**Plan' },
    )
    const continued = appendReasoningSummaryDelta(first, {
      item_id: 'rs_1',
      summary_index: 0,
      delta: 'ning**',
    })

    expect(continued.text).toBe('**Planning**')
    expect(continued.partKey).toBe(first.partKey)
  })

  it('distinguishes delta slots when compacting replay events', () => {
    const first = responseDeltaIdentityKey('response.reasoning_summary_text.delta', {
      delta: 'a',
      item_id: 'rs_1',
      output_index: 0,
      summary_index: 0,
    })
    const second = responseDeltaIdentityKey('response.reasoning_summary_text.delta', {
      delta: 'b',
      item_id: 'rs_1',
      output_index: 0,
      summary_index: 1,
    })

    expect(first).not.toBe(second)
  })

  it('keeps raw reasoning deltas contiguous and separates reasoning items', () => {
    const first = appendReasoningTextDelta(
      { text: '', partKey: null },
      { item_id: 'rs_1', output_index: 0, content_index: 0, delta: '第一' },
    )
    const continued = appendReasoningTextDelta(first, {
      item_id: 'rs_1',
      output_index: 0,
      content_index: 0,
      delta: '段',
    })
    const nextItem = appendReasoningTextDelta(continued, {
      item_id: 'rs_2',
      output_index: 2,
      content_index: 0,
      delta: '第二段',
    })

    expect(nextItem).toEqual({
      text: '第一段\n\n第二段',
      partKey: reasoningTextPartKey({ item_id: 'rs_2', output_index: 2, content_index: 0 }),
    })
  })

  it('distinguishes raw reasoning content slots when compacting replay events', () => {
    const first = responseDeltaIdentityKey('response.reasoning_text.delta', {
      delta: 'a',
      item_id: 'rs_1',
      output_index: 0,
      content_index: 0,
    })
    const second = responseDeltaIdentityKey('response.reasoning_text.delta', {
      delta: 'b',
      item_id: 'rs_2',
      output_index: 1,
      content_index: 0,
    })

    expect(first).not.toBe(second)
  })
})
