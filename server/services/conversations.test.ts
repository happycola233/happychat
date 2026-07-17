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

describe('reasoning timing helpers', () => {
  it('measures reasoning until the first output text delta', () => {
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
