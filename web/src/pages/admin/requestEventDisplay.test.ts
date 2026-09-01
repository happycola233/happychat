import { describe, expect, it } from 'vitest'
import {
  formatCacheRate,
  formatGenerationSpeed,
  formatRequestEventTimestamp,
  formatRequestLatency,
} from './requestEventDisplay'

describe('request event display', () => {
  it('splits local time and date into fixed-width values', () => {
    const timestamp = new Date(2026, 8, 1, 20, 54, 40).getTime()

    expect(formatRequestEventTimestamp(timestamp)).toEqual({
      time: '20:54:40',
      date: '2026/09/01',
    })
  })

  it('formats latency and generation speed like request metrics', () => {
    expect(formatRequestLatency(9_290)).toBe('9.29秒')
    expect(formatRequestLatency(4_900)).toBe('4.9秒')
    expect(formatRequestLatency(76_000)).toBe('1分钟 16秒')
    expect(formatRequestLatency(null)).toBe('-')
    expect(formatGenerationSpeed(32.256)).toBe('32.3 t/s')
    expect(formatGenerationSpeed(null)).toBe('-')
  })

  it('uses cached input divided by all input tokens for the cache rate', () => {
    expect(formatCacheRate(3_712, 10_117)).toBe('36.69%')
    expect(formatCacheRate(0, 4_789)).toBe('0.00%')
    expect(formatCacheRate(0, 0)).toBe('-')
  })
})
