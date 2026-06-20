import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildErrorEventsQuery,
  buildUsageEventsQuery,
  errorEventsQueryKey,
  usageEventsQueryKey,
  type ErrorEventsFilterState,
  type UsageEventsFilterState,
} from './eventFilters'

afterEach(() => {
  vi.useRealTimers()
})

describe('admin event filters', () => {
  it('keeps usage event query keys stable while the relative range slides at request time', () => {
    const filter: UsageEventsFilterState = {
      rangeKey: '7d',
      providerId: '',
      modelId: '',
      userId: '',
      successSel: '',
      page: 1,
      pageSize: 50,
    }

    vi.useFakeTimers()
    vi.setSystemTime(10_000_000)
    const firstKey = usageEventsQueryKey(filter)
    const firstQuery = buildUsageEventsQuery(filter)

    vi.setSystemTime(10_030_000)
    const secondKey = usageEventsQueryKey(filter)
    const secondQuery = buildUsageEventsQuery(filter)

    expect(secondKey).toEqual(firstKey)
    expect(secondQuery.from).toBe((firstQuery.from ?? 0) + 30_000)
  })

  it('keeps error event query keys stable and trims search once', () => {
    const filter: ErrorEventsFilterState = {
      rangeKey: '24h',
      scopeSel: 'server',
      search: '  upstream timeout  ',
      page: 2,
      pageSize: 50,
    }

    vi.useFakeTimers()
    vi.setSystemTime(20_000_000)
    const firstKey = errorEventsQueryKey(filter)
    const firstQuery = buildErrorEventsQuery(filter)

    vi.setSystemTime(20_060_000)
    const secondKey = errorEventsQueryKey(filter)
    const secondQuery = buildErrorEventsQuery(filter)

    expect(secondKey).toEqual(firstKey)
    expect(firstKey).toContain('upstream timeout')
    expect(firstQuery.search).toBe('upstream timeout')
    expect(secondQuery.from).toBe((firstQuery.from ?? 0) + 60_000)
  })
})
