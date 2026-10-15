import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatMessageDay,
  formatMessageTime,
  formatMessageTimeDetails,
  isSameLocalDay,
} from './messageTime'

afterEach(() => vi.unstubAllEnvs())

function localDate(year: number, month: number, day: number, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).getTime()
}

function smart(timestamp: number, today: number) {
  return formatMessageTime(
    timestamp,
    'smart',
    today,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
}

describe('消息时间', () => {
  it('智能格式区分今天、昨天、本年其他日期和跨年日期', () => {
    const today = localDate(2026, 10, 16)
    expect(smart(localDate(2026, 10, 16, 14, 32), today)).toBe('14:32')
    expect(smart(localDate(2026, 10, 15, 14, 32), today)).toBe('昨天 14:32')
    expect(smart(localDate(2026, 10, 12, 14, 32), today)).toBe('10月12日 14:32')
    expect(smart(localDate(2025, 10, 12, 14, 32), today)).toBe('2025年10月12日 14:32')
    expect(smart(localDate(2025, 12, 31, 23, 59), localDate(2026, 1, 1))).toBe(
      '2025年12月31日 23:59',
    )
  })

  it('过午夜即变为昨天，月份和闰日不影响自然日判断', () => {
    expect(smart(localDate(2026, 10, 15, 23, 59), localDate(2026, 10, 16))).toBe('昨天 23:59')
    expect(smart(localDate(2024, 2, 29, 14, 32), localDate(2024, 3, 1))).toBe('昨天 14:32')
    expect(smart(localDate(2026, 9, 30, 14, 32), localDate(2026, 10, 1))).toBe('昨天 14:32')
  })

  it('所有格式使用 24 小时制，完整时间始终保留年月日', () => {
    const timestamp = localDate(2026, 10, 16)
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(formatMessageTime(timestamp, 'time', timestamp, timeZone)).toBe('00:00')
    expect(formatMessageTime(timestamp, 'datetime', timestamp, timeZone)).toBe('2026/10/16 00:00')
  })

  it('详情显示星期、秒和消息发生时的 UTC 偏移', () => {
    const timestamp = Date.parse('2026-10-16T06:32:08Z')
    expect(formatMessageTimeDetails(timestamp, 'Asia/Shanghai')).toEqual({
      date: '2026年10月16日星期五',
      time: '14:32:08 · UTC+08:00',
    })
    expect(formatMessageTimeDetails(timestamp, 'America/New_York').time).toBe(
      '02:32:08 · UTC-04:00',
    )
    expect(
      formatMessageTimeDetails(Date.parse('2026-01-16T06:32:08Z'), 'America/New_York').time,
    ).toBe('01:32:08 · UTC-05:00')
  })

  it('日期分组只比较相邻消息的本地自然日，不要求消息时间递增', () => {
    const today = localDate(2026, 10, 16)
    expect(isSameLocalDay(localDate(2026, 10, 16, 0, 1), localDate(2026, 10, 15, 23, 59))).toBe(
      false,
    )
    expect(isSameLocalDay(localDate(2026, 10, 16, 14), localDate(2026, 10, 16, 15))).toBe(true)
    expect(
      formatMessageDay(
        localDate(2026, 10, 15),
        today,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ).toBe('2026年10月15日 · 昨天')
  })

  it('夏令时开始和结束后的昨天仍按自然日判断', () => {
    vi.stubEnv('TZ', 'America/New_York')
    expect(localDate(2026, 3, 9) - localDate(2026, 3, 8)).toBe(23 * 60 * 60 * 1000)
    expect(smart(localDate(2026, 3, 8, 0, 30), localDate(2026, 3, 9))).toBe('昨天 00:30')
    expect(smart(localDate(2026, 11, 1, 0, 30), localDate(2026, 11, 2))).toBe('昨天 00:30')
  })
})
