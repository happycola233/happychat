import { describe, expect, it } from 'vitest'
import {
  canonicalizeIanaTimezone,
  zonedDateParts,
  zonedMidnightMs,
  zonedOffsetMinutes,
} from './timezone'

describe('IANA 时区日历 helper', () => {
  it('规范化合法时区并拒绝非法名称', () => {
    expect(canonicalizeIanaTimezone('Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(canonicalizeIanaTimezone('Not/AZone')).toBeNull()
  })

  it('同一地区会按历史时刻返回不同 DST 偏移', () => {
    expect(zonedOffsetMinutes(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300)
    expect(zonedOffsetMinutes(Date.parse('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240)
  })

  it('DST 开始日的相邻当地午夜相差 23 小时', () => {
    const start = zonedMidnightMs(2026, 3, 8, 'America/New_York')
    const end = zonedMidnightMs(2026, 3, 9, 'America/New_York')
    expect(new Date(start).toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(end - start).toBe(23 * 3_600_000)
    expect(zonedDateParts(end, 'America/New_York')).toMatchObject({
      year: 2026,
      month: 3,
      day: 9,
      hour: 0,
    })
  })

  it('当地 00:00 被跳过时返回目标日期的第一个真实时刻', () => {
    const start = zonedMidnightMs(2026, 9, 6, 'America/Santiago')
    expect(new Date(start).toISOString()).toBe('2026-09-06T04:00:00.000Z')
    expect(zonedDateParts(start, 'America/Santiago')).toMatchObject({
      year: 2026,
      month: 9,
      day: 6,
      hour: 1,
      minute: 0,
    })
    expect(zonedDateParts(start - 1, 'America/Santiago')).toMatchObject({
      year: 2026,
      month: 9,
      day: 5,
    })
  })
})
