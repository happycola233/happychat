import { describe, expect, it } from 'vitest'
import { MAX_USAGE_WINDOW_TIMER_MS, displayedUsageView, usageWindowTimerDelay } from './usageWindow'

describe('使用统计窗口刷新', () => {
  it('窗口到期后要求立即刷新，并在到期前留出短暂服务端跨界余量', () => {
    expect(usageWindowTimerDelay(10_000, 10_251)).toBeNull()
    expect(usageWindowTimerDelay(10_000, 9_750)).toBe(500)
  })

  it('超过浏览器定时器上限的年窗口分段等待', () => {
    expect(usageWindowTimerDelay(MAX_USAGE_WINDOW_TIMER_MS + 10_000, 0)).toBe(
      MAX_USAGE_WINDOW_TIMER_MS,
    )
  })

  it('占位数据展示其自身窗口口径', () => {
    expect(displayedUsageView('day', 'month')).toBe('month')
    expect(displayedUsageView('day', undefined)).toBe('day')
  })
})
