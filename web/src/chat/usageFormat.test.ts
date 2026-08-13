import { describe, expect, it } from 'vitest'
import {
  computeTps,
  formatCostUsd,
  formatMessageCost,
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

describe('formatCostUsd', () => {
  it('hides zero and keeps useful precision for small USD costs', () => {
    expect(formatCostUsd(0)).toBeNull()
    expect(formatCostUsd(null)).toBeNull()
    expect(formatCostUsd(0.00006)).toBe('$0.00006')
    expect(formatCostUsd(0.5)).toBe('$0.50')
    expect(formatCostUsd(0.0000004)).toBe('<$0.000001')
  })
})

describe('formatMessageCost', () => {
  it('按实时汇率展示 CNY，并在提示中保留原始 USD 和汇率', () => {
    expect(
      formatMessageCost(0.0681, { currency: 'CNY', usdToCnyRate: 7.123456 }),
    ).toEqual({
      value: '¥0.4851',
      title:
        '本次预估成本（CNY）；原始成本：$0.0681 USD；汇率：1 USD ≈ 7.123456 CNY',
    })
  })

  it('CNY 汇率不可用时回退显示原始 USD', () => {
    expect(formatMessageCost(0.0681, { currency: 'CNY', usdToCnyRate: null })).toEqual({
      value: '$0.0681',
      title: '人民币实时汇率暂不可用，显示原始成本：$0.0681 USD',
    })
  })
})

describe('formatDuration', () => {
  it('formats sub-second, seconds and minutes', () => {
    expect(formatDuration(214)).toBe('0.2s')
    expect(formatDuration(5400)).toBe('5.4s')
    expect(formatDuration(30700)).toBe('31s')
    expect(formatDuration(65000)).toBe('1m 05s')
    expect(formatDuration(90000)).toBe('1m 30s')
    expect(formatDuration(112000)).toBe('1m 52s')
    expect(formatDuration(119600)).toBe('2m 00s')
  })
})

describe('formatMessageTime', () => {
  it('renders 24-hour HH:mm', () => {
    expect(formatMessageTime(Date.UTC(2026, 5, 20, 3, 4))).toMatch(/^\d{2}:\d{2}$/)
  })
})
