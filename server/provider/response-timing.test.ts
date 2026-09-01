import { describe, expect, it } from 'vitest'
import { UpstreamResponseLatencyTracker } from './response-timing'

describe('UpstreamResponseLatencyTracker', () => {
  it('uses the first request start through the first successful response headers', () => {
    const tracker = new UpstreamResponseLatencyTracker()
    tracker.onRequestStart(1_000)
    tracker.onResponseHeaders({ requestStartedAtMs: 1_000, responseHeadersAtMs: 1_300, ok: false })
    tracker.onRequestStart(1_450)
    tracker.onResponseHeaders({ requestStartedAtMs: 1_450, responseHeadersAtMs: 1_900, ok: true })

    expect(tracker.latencyMs).toBe(900)
  })

  it('keeps the first failed response when no request succeeds', () => {
    const tracker = new UpstreamResponseLatencyTracker()
    tracker.onResponseHeaders({ requestStartedAtMs: 2_000, responseHeadersAtMs: 2_240, ok: false })
    tracker.onResponseHeaders({ requestStartedAtMs: 2_300, responseHeadersAtMs: 2_700, ok: false })

    expect(tracker.latencyMs).toBe(240)
  })

  it('does not replace the first success during later continuation requests', () => {
    const tracker = new UpstreamResponseLatencyTracker()
    tracker.onResponseHeaders({ requestStartedAtMs: 3_000, responseHeadersAtMs: 3_420, ok: true })
    tracker.onResponseHeaders({ requestStartedAtMs: 4_000, responseHeadersAtMs: 4_800, ok: true })

    expect(tracker.latencyMs).toBe(420)
  })

  it('returns null until an HTTP response is received', () => {
    const tracker = new UpstreamResponseLatencyTracker()
    tracker.onRequestStart(5_000)

    expect(tracker.latencyMs).toBeNull()
  })
})
