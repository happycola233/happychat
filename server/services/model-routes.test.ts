import { describe, expect, it } from 'vitest'
import {
  ROUTE_BREAKER_THRESHOLD,
  RouteHealthRegistry,
  isRouteFault,
  orderRouteCandidates,
  type RouteTarget,
} from './model-routes'

function target(id: string, priority: number, weight = 1): RouteTarget {
  return {
    route: {
      id,
      modelId: 'model',
      providerId: `provider-${id}`,
      upstreamModelId: null,
      priority,
      weight,
      enabled: true,
      costPricing: null,
      sort: 0,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    provider: {
      id: `provider-${id}`,
      name: id,
      baseUrl: 'https://example.test/v1',
      apiKey: 'key',
      extraHeaders: {},
      protocol: 'openai',
      enabled: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    upstreamModelId: 'gpt-test',
  }
}

const ids = (targets: RouteTarget[]) => targets.map((item) => item.route.id)

describe('orderRouteCandidates', () => {
  it('tries higher priority tiers first regardless of weight', () => {
    const health = new RouteHealthRegistry()
    const ordered = orderRouteCandidates(
      [target('backup', 0, 100), target('primary', 10, 1), target('secondary', 5, 50)],
      { health, random: () => 0.5 },
    )
    expect(ids(ordered)).toEqual(['primary', 'secondary', 'backup'])
  })

  it('splits traffic inside one tier proportionally to weight', () => {
    const health = new RouteHealthRegistry()
    let seed = 42
    // 线性同余伪随机，保证测试可复现。
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
    const firsts = { heavy: 0, light: 0 }
    for (let i = 0; i < 4000; i++) {
      const [first] = orderRouteCandidates([target('heavy', 0, 3), target('light', 0, 1)], {
        health,
        random,
      })
      firsts[first!.route.id as 'heavy' | 'light'] += 1
    }
    expect(firsts.heavy / 4000).toBeGreaterThan(0.7)
    expect(firsts.heavy / 4000).toBeLessThan(0.8)
  })

  it('moves cooling routes behind every healthy route but keeps them as a last resort', () => {
    const health = new RouteHealthRegistry()
    for (let i = 0; i < ROUTE_BREAKER_THRESHOLD; i++) health.recordFailure('primary', '503', 1_000)
    const ordered = orderRouteCandidates([target('primary', 10), target('backup', 0)], {
      health,
      now: 2_000,
    })
    expect(ids(ordered)).toEqual(['backup', 'primary'])
  })
})

describe('RouteHealthRegistry', () => {
  it('opens the breaker after consecutive failures, backs off exponentially and resets on success', () => {
    const health = new RouteHealthRegistry()
    health.recordFailure('route', 'first', 0)
    health.recordFailure('route', 'second', 0)
    expect(health.snapshot('route', 0)).toMatchObject({ state: 'degraded', cooldownUntil: null })
    health.recordFailure('route', 'third', 0)
    expect(health.snapshot('route', 0)).toMatchObject({
      state: 'cooling',
      cooldownUntil: 30_000,
      lastFailureMessage: 'third',
    })
    health.recordFailure('route', 'fourth', 0)
    expect(health.snapshot('route', 0).cooldownUntil).toBe(60_000)
    expect(health.isCooling('route', 60_001)).toBe(false)
    health.recordSuccess('route', 70_000)
    expect(health.snapshot('route', 70_000)).toMatchObject({
      state: 'healthy',
      consecutiveFailures: 0,
      lastSuccessAt: 70_000,
    })
  })
})

describe('isRouteFault', () => {
  it.each([
    [{ errorType: 'network_error', errorCode: null, httpStatus: 0 }],
    [{ errorType: null, errorCode: null, httpStatus: 503 }],
    [{ errorType: null, errorCode: null, httpStatus: 401 }],
    [{ errorType: 'insufficient_quota', errorCode: 'insufficient_quota', httpStatus: 429 }],
    [{ errorType: null, errorCode: 'model_not_found', httpStatus: 404 }],
    [{ errorType: 'first_output_timeout', errorCode: null, httpStatus: null }],
  ])('switches routes for upstream-side failure %o', (identity) => {
    expect(isRouteFault(identity)).toBe(true)
  })

  it.each([
    [{ errorType: 'invalid_request_error', errorCode: null, httpStatus: 400 }],
    [{ errorType: null, errorCode: 'context_length_exceeded', httpStatus: 400 }],
    [{ errorType: 'refusal', errorCode: 'refusal', httpStatus: 200 }],
    [{ errorType: null, errorCode: 'invalid_image', httpStatus: 400 }],
  ])('keeps request-side failure %o on the current route', (identity) => {
    expect(isRouteFault(identity)).toBe(false)
  })
})
