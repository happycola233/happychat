import { describe, expect, it } from 'vitest'
import {
  computeFirstTokenLatencyMs,
  computeGenerationDurationMs,
  computeGenerationTokensPerSecond,
} from './run-timing'

describe('run timing metrics', () => {
  it('computes wall-clock and first-token latency from persisted timestamps', () => {
    const startedAt = new Date(10_000)

    expect(computeGenerationDurationMs(startedAt, new Date(19_290))).toBe(9_290)
    expect(computeFirstTokenLatencyMs(startedAt, 13_160)).toBe(3_160)
  })

  it('computes generation speed from the post-first-token interval', () => {
    expect(computeGenerationTokensPerSecond(198, 9_290, 3_160)).toBeCloseTo(32.3002, 4)
  })

  it('does not invent speed without output, timing, or a positive generation interval', () => {
    expect(computeGenerationTokensPerSecond(0, 9_290, 3_160)).toBeNull()
    expect(computeGenerationTokensPerSecond(198, null, 3_160)).toBeNull()
    expect(computeGenerationTokensPerSecond(198, 9_290, null)).toBeNull()
    expect(computeGenerationTokensPerSecond(198, 3_160, 3_160)).toBeNull()
  })
})
