import { describe, expect, it } from 'vitest'
import { compactRunEventsForReplay, type ReplayableRunEvent } from './replay'

const ev = (
  sequenceNumber: number,
  type: string,
  data: Record<string, unknown> = {},
): ReplayableRunEvent => ({
  type,
  sequenceNumber,
  data,
})

describe('compactRunEventsForReplay', () => {
  it('merges consecutive text deltas and keeps the latest sequence cursor', () => {
    const compacted = compactRunEventsForReplay([
      ev(0, 'run.created'),
      ev(1, 'response.output_text.delta', { delta: '你', item_id: 'msg_1' }),
      ev(2, 'response.output_text.delta', { delta: '好', item_id: 'msg_1' }),
      ev(3, 'run.done', { state: 'completed' }),
    ])

    expect(compacted).toEqual([
      ev(0, 'run.created'),
      ev(2, 'response.output_text.delta', { delta: '你好', item_id: 'msg_1' }),
      ev(3, 'run.done', { state: 'completed' }),
    ])
  })

  it('does not merge across event types or output slots', () => {
    const compacted = compactRunEventsForReplay([
      ev(1, 'response.output_text.delta', { delta: 'a', item_id: 'msg_1' }),
      ev(2, 'response.reasoning_summary_text.delta', { delta: 'b', item_id: 'rs_1' }),
      ev(3, 'response.reasoning_summary_text.delta', { delta: 'c', item_id: 'rs_2' }),
      ev(4, 'response.output_text.delta', { delta: 'd', item_id: 'msg_1' }),
    ])

    expect(compacted).toEqual([
      ev(1, 'response.output_text.delta', { delta: 'a', item_id: 'msg_1' }),
      ev(2, 'response.reasoning_summary_text.delta', { delta: 'b', item_id: 'rs_1' }),
      ev(3, 'response.reasoning_summary_text.delta', { delta: 'c', item_id: 'rs_2' }),
      ev(4, 'response.output_text.delta', { delta: 'd', item_id: 'msg_1' }),
    ])
  })
})
