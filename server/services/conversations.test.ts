import { describe, expect, it } from 'vitest'
import {
  computeReasoningDurationMs,
  reasoningStartedAtMs,
  type ReasoningTimingEvent,
} from './reasoning-timing'

const ev = (type: string, sequenceNumber: number, ms: number): ReasoningTimingEvent => ({
  type,
  sequenceNumber,
  createdAt: new Date(ms),
})

const itemEvent = (
  type: string,
  sequenceNumber: number,
  ms: number,
  itemId: string,
): ReasoningTimingEvent => ({
  ...ev(type, sequenceNumber, ms),
  data: { itemId },
})

describe('reasoning timing helpers', () => {
  it('falls back to the first output text delta for old runs without answer.started', () => {
    const events = [
      ev('run.created', 0, 900),
      ev('response.created', 1, 1000),
      ev('response.reasoning_summary_text.delta', 2, 1800),
      ev('response.output_text.delta', 3, 4500),
      ev('run.done', 4, 9000),
    ]

    expect(reasoningStartedAtMs(events)).toBe(1000)
    expect(computeReasoningDurationMs(events)).toBe(3500)
  })

  it('does not truncate reasoning duration when commentary output arrives before the answer', () => {
    const events = [
      ev('response.created', 1, 1000),
      ev('response.reasoning_summary_text.delta', 2, 1400),
      ev('response.output_text.delta', 3, 1600),
      ev('answer.started', 4, 5200),
      ev('response.output_text.delta', 5, 5201),
    ]

    expect(computeReasoningDurationMs(events)).toBe(4200)
  })

  it('ignores answer.started that was reclassified from raw reasoning commentary', () => {
    const events = [
      ev('response.created', 1, 1000),
      itemEvent('answer.started', 2, 1500, 'commentary-1'),
      itemEvent('response.output_item.reclassified', 3, 2200, 'commentary-1'),
      itemEvent('answer.started', 4, 6200, 'final-1'),
      ev('run.done', 5, 9000),
    ]

    expect(computeReasoningDurationMs(events)).toBe(5200)
  })

  it('uses the terminal time when every provisional answer was reclassified', () => {
    const events = [
      ev('response.created', 1, 1000),
      itemEvent('answer.started', 2, 1500, 'commentary-1'),
      itemEvent('response.output_item.reclassified', 3, 2200, 'commentary-1'),
      ev('response.output_text.delta', 4, 2300),
      ev('run.interrupted', 5, 7000),
    ]

    expect(computeReasoningDurationMs(events)).toBe(6000)
  })

  it('falls back to reasoning summary deltas as the start marker', () => {
    const events = [
      ev('run.created', 0, 900),
      ev('response.reasoning_summary_text.delta', 1, 1200),
      ev('response.output_text.delta', 2, 3000),
    ]

    expect(reasoningStartedAtMs(events)).toBe(1200)
    expect(computeReasoningDurationMs(events)).toBe(1800)
  })

  it('uses a terminal event when no output text is emitted', () => {
    expect(
      computeReasoningDurationMs([ev('response.created', 1, 1000), ev('run.done', 2, 2400)]),
    ).toBe(1400)
  })

  it('uses run finishedAt before the persisted terminal event is available', () => {
    expect(computeReasoningDurationMs([ev('response.created', 1, 1000)], new Date(2400))).toBe(1400)
  })

  it('keeps persisted terminal timing aligned with the earlier run finishedAt', () => {
    expect(
      computeReasoningDurationMs(
        [ev('response.created', 1, 1000), ev('run.done', 2, 2500)],
        new Date(2400),
      ),
    ).toBe(1400)
  })
})
