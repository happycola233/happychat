import { describe, expect, it } from 'vitest'
import {
  computeTps,
  formatDuration,
  formatMessageTime,
  formatTokens,
  formatTps,
} from './usageFormat'

describe('formatTokens', () => {
  it('formats small / K / M ranges', () => {
    expect(formatTokens(16)).toBe('16')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1000)).toBe('1K')
    expect(formatTokens(2700)).toBe('2.7K')
    expect(formatTokens(3100)).toBe('3.1K')
    expect(formatTokens(150000)).toBe('150K')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})

describe('computeTps / formatTps', () => {
  it('computes tokens-per-second, null when data is insufficient', () => {
    expect(computeTps(16, 214)).toBeCloseTo(74.8, 1)
    expect(computeTps(0, 1000)).toBeNull()
    expect(computeTps(10, 0)).toBeNull()
    expect(computeTps(10, null)).toBeNull()
  })

  it('formats tps with one decimal under 100, integer above', () => {
    expect(formatTps(74.77)).toBe('74.8')
    expect(formatTps(120.4)).toBe('120')
  })
})

describe('formatDuration', () => {
  it('formats sub-second, seconds and minutes', () => {
    expect(formatDuration(214)).toBe('0.2s')
    expect(formatDuration(5400)).toBe('5.4s')
    expect(formatDuration(30700)).toBe('31s')
    expect(formatDuration(65000)).toBe('1m05s')
    expect(formatDuration(90000)).toBe('1m30s')
  })
})

describe('formatMessageTime', () => {
  it('renders 24-hour HH:mm', () => {
    expect(formatMessageTime(Date.UTC(2026, 5, 20, 3, 4))).toMatch(/^\d{2}:\d{2}$/)
  })
})
