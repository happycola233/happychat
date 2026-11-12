import { describe, expect, it } from 'vitest'
import {
  dateRangeParams,
  dateRangeSlug,
  draftDateRange,
  formatDateRange,
  rangeToFilter,
  readDateRange,
  resolveDateRange,
  withDateRange,
  type DateRange,
} from './dateRange'

// 用本地时间构造，断言与运行环境的时区无关。
const local = (month: number, day: number, hour = 0, minute = 0, year = 2026) =>
  new Date(year, month - 1, day, hour, minute).getTime()
const NOW = local(11, 12, 15, 30) + 20_000

describe('date range', () => {
  it('splits today and yesterday at local midnight and sends a closed upper bound', () => {
    expect(resolveDateRange({ key: 'today' }, NOW)).toEqual({
      start: local(11, 12),
      end: local(11, 13),
    })
    expect(rangeToFilter({ key: 'yesterday' }, NOW)).toEqual({
      from: local(11, 11),
      to: local(11, 12) - 1,
    })
  })

  it('leaves the end of rolling ranges to the server clock', () => {
    expect(rangeToFilter({ key: '24h' }, NOW)).toEqual({ from: NOW - 86_400_000, to: undefined })
    expect(rangeToFilter({ key: 'all' }, NOW)).toEqual({ from: undefined, to: undefined })
  })

  it('round-trips custom ranges through readable URL params and keeps other filters', () => {
    const range: DateRange = { key: 'custom', start: local(11, 11, 8, 30), end: local(11, 12, 18) }
    expect(dateRangeParams(range)).toEqual({
      range: 'custom',
      from: '2026-11-11T08:30',
      to: '2026-11-12T18:00',
    })
    const next = withDateRange(new URLSearchParams('range=custom&from=x&to=y&kind=chat'), range)
    expect(next.get('kind')).toBe('chat')
    expect(readDateRange(next)).toEqual(range)
    expect(withDateRange(next, { key: 'today' }).toString()).toBe('kind=chat&range=today')
    expect(dateRangeSlug(range)).toBe('2026-11-11T0830_2026-11-12T1800')
  })

  it('falls back to the default range for unknown or inverted URL values', () => {
    expect(readDateRange(new URLSearchParams('range=toString'))).toEqual({ key: '7d' })
    expect(
      readDateRange(new URLSearchParams('range=custom&from=2026-11-12T10:00&to=2026-11-12T09:00')),
    ).toEqual({ key: '7d' })
    expect(readDateRange(new URLSearchParams('range=custom&from=2026-11-12'))).toEqual({
      key: '7d',
    })
  })

  it('labels whole days inclusively and partial days to the minute', () => {
    const custom = (start: number, end: number) =>
      formatDateRange({ key: 'custom', start, end }, NOW)
    expect(formatDateRange({ key: 'yesterday' }, NOW)).toBe('昨天')
    expect(custom(local(11, 11), local(11, 12))).toBe('11月11日')
    expect(custom(local(11, 10), local(11, 12))).toBe('11月10日 – 11月11日')
    expect(custom(local(11, 11, 8, 30), local(11, 11, 18))).toBe('11月11日 08:30 – 18:00')
    expect(custom(local(12, 31, 22, 0, 2025), local(11, 12, 0, 5))).toBe(
      '2025年12月31日 22:00 – 11月12日 00:05',
    )
  })

  it('prefills the custom form with whole minutes of the current range', () => {
    expect(draftDateRange({ key: '24h' }, NOW)).toEqual({
      start: local(11, 11, 15, 30),
      end: local(11, 12, 15, 31),
    })
    expect(draftDateRange({ key: 'all' }, NOW)).toEqual({
      start: local(11, 12),
      end: local(11, 12, 15, 31),
    })
  })
})
