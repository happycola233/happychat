import { describe, expect, it } from 'vitest'
import {
  comparisonLabel,
  dashboardHref,
  EMPTY_ANALYTICS_POINT,
  fillTimeBuckets,
  readDashboardFilters,
  summarizeAnalytics,
} from './dashboardData'

describe('dashboard data', () => {
  it('fills inactive buckets without extending past the current bucket', () => {
    const rows = [
      { ts: 3600000, requests: 3 },
      { ts: 10800000, requests: 1 },
    ]
    expect(fillTimeBuckets(rows, 'hour', 100, 14500000, { requests: 0 })).toEqual([
      { ts: 0, requests: 0 },
      { ts: 3600000, requests: 3 },
      { ts: 7200000, requests: 0 },
      { ts: 10800000, requests: 1 },
      { ts: 14400000, requests: 0 },
    ])
    const emptyRows: typeof rows = []
    expect(fillTimeBuckets(emptyRows, 'hour', 0, 14500000, { requests: 0 })).toEqual([])
    expect(fillTimeBuckets(rows, 'hour', undefined, 11000000, { requests: 0 })[0]?.ts).toBe(3600000)
  })
  it('uses audited total tokens without adding cache and reasoning subsets twice', () => {
    const totals = summarizeAnalytics([
      {
        ...EMPTY_ANALYTICS_POINT,
        ts: 0,
        requests: 1,
        totalTokens: 1200,
        inputTokens: 1000,
        cachedTokens: 300,
        cacheWriteTokens: 200,
        outputTokens: 200,
        reasoningTokens: 50,
      },
    ])
    expect(totals.totalTokens).toBe(1200)
    expect(totals.cachedTokens).toBe(300)
  })
  it('keeps drill-down filters and rejects unknown URL enums', () => {
    const href = dashboardHref('request-events', {
      range: '30d',
      userId: 'user + 1',
      kind: 'title',
      result: 'refused',
      modelId: '',
    })
    const parsed = readDashboardFilters(new URL(href, 'https://example.com').searchParams)
    expect(parsed).toEqual({
      rangeKey: '30d',
      userId: 'user + 1',
      modelId: '',
      providerId: '',
      kindSel: 'title',
      resultSel: 'refused',
    })
    expect(readDashboardFilters(new URLSearchParams('range=no&kind=no&result=toString'))).toEqual(
      expect.objectContaining({ rangeKey: '7d', kindSel: '', resultSel: '' }),
    )
  })
  it('does not show infinite growth from an empty previous period', () => {
    expect(comparisonLabel(3, 0)).toBe('上一时段为 0')
    expect(comparisonLabel(0, 0)).toBe('与上一时段持平')
    expect(comparisonLabel(50, 100)).toBe('↓ 50.0% 较上一时段')
  })
})
