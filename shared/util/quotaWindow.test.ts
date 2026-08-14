import { describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS, describeQuotaWindow, resolveQuotaPeriod } from './quotaWindow'

const SHANGHAI = { timezone: 'Asia/Shanghai', weekStart: 'mon' as const }
const NEW_YORK = { timezone: 'America/New_York', weekStart: 'sun' as const }

/** 便于断言：把 UTC 毫秒转成 ISO 字符串（Z 结尾）。 */
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

describe('resolveQuotaPeriod · 日历周期', () => {
  it('按配置时区（而非服务器时区）划分自然日', () => {
    // 2026-03-14T20:30Z = 上海 2026-03-15 04:30，属于 3/15 这一天
    const period = resolveQuotaPeriod(
      { type: 'calendar', period: 'day' },
      Date.parse('2026-03-14T20:30:00Z'),
      SHANGHAI,
    )
    expect(iso(period.startMs)).toBe('2026-03-14T16:00:00.000Z') // 上海 3/15 00:00
    expect(iso(period.endMs)).toBe('2026-03-15T16:00:00.000Z')
  })

  it('周窗口支持周一 / 周日两种起始日', () => {
    const now = Date.parse('2026-03-18T09:00:00Z') // 周三
    const monday = resolveQuotaPeriod({ type: 'calendar', period: 'week' }, now, SHANGHAI)
    expect(iso(monday.startMs)).toBe('2026-03-15T16:00:00.000Z') // 上海 3/16 周一 00:00
    expect(monday.endMs! - monday.startMs).toBe(7 * DAY_MS)

    const sunday = resolveQuotaPeriod({ type: 'calendar', period: 'week' }, now, {
      timezone: 'Asia/Shanghai',
      weekStart: 'sun',
    })
    expect(iso(sunday.startMs)).toBe('2026-03-14T16:00:00.000Z') // 上海 3/15 周日 00:00
  })

  it('月窗口跨年时正确进位', () => {
    const period = resolveQuotaPeriod(
      { type: 'calendar', period: 'month' },
      Date.parse('2026-12-20T00:00:00Z'),
      SHANGHAI,
    )
    expect(iso(period.startMs)).toBe('2026-11-30T16:00:00.000Z') // 上海 12/1 00:00
    expect(iso(period.endMs)).toBe('2026-12-31T16:00:00.000Z') // 上海 次年 1/1 00:00
  })

  it('闰年 2 月按实际天数结束', () => {
    const period = resolveQuotaPeriod(
      { type: 'calendar', period: 'month' },
      Date.parse('2028-02-10T00:00:00Z'),
      SHANGHAI,
    )
    expect(period.endMs! - period.startMs).toBe(29 * DAY_MS)
  })

  it('DST 开始当天的日边界仍是本地 00:00（当天只有 23 小时）', () => {
    // 美东 2026-03-08 02:00 进入夏令时
    const period = resolveQuotaPeriod(
      { type: 'calendar', period: 'day' },
      Date.parse('2026-03-08T18:00:00Z'),
      NEW_YORK,
    )
    expect(iso(period.startMs)).toBe('2026-03-08T05:00:00.000Z') // EST -05:00 的本地 00:00
    expect(iso(period.endMs)).toBe('2026-03-09T04:00:00.000Z') // EDT -04:00 的本地 00:00
    expect(period.endMs! - period.startMs).toBe(23 * HOUR_MS)
  })

  it('DST 结束当天有 25 小时', () => {
    // 美东 2026-11-01 02:00 退出夏令时
    const period = resolveQuotaPeriod(
      { type: 'calendar', period: 'day' },
      Date.parse('2026-11-01T12:00:00Z'),
      NEW_YORK,
    )
    expect(period.endMs! - period.startMs).toBe(25 * HOUR_MS)
  })

  it('跨 DST 的周窗口按墙上日期推进 7 天，而不是固定 168 小时', () => {
    const period = resolveQuotaPeriod(
      { type: 'calendar', period: 'week' },
      Date.parse('2026-03-10T12:00:00Z'),
      NEW_YORK,
    )
    expect(iso(period.startMs)).toBe('2026-03-08T05:00:00.000Z') // 周日 00:00 EST
    expect(period.endMs! - period.startMs).toBe(7 * DAY_MS - HOUR_MS)
  })

  it('时区非法时退化为 UTC，仍保证 start < end', () => {
    const now = Date.parse('2026-03-18T09:00:00Z')
    const period = resolveQuotaPeriod({ type: 'calendar', period: 'month' }, now, {
      timezone: 'Not/AZone',
      weekStart: 'mon',
    })
    expect(iso(period.startMs)).toBe('2026-03-01T00:00:00.000Z')
    expect(iso(period.endMs)).toBe('2026-04-01T00:00:00.000Z')
  })
})

describe('resolveQuotaPeriod · 滚动窗口与永久累计', () => {
  it('滚动窗口不对齐任何边界', () => {
    const now = Date.parse('2026-03-18T09:17:33Z')
    expect(resolveQuotaPeriod({ type: 'rolling', hours: 5 }, now, SHANGHAI)).toEqual({
      startMs: now - 5 * HOUR_MS,
      endMs: null,
    })
  })

  it('滚动窗口长度做安全钳制（最短 1 小时、最长 1 年）', () => {
    const now = Date.parse('2026-03-18T09:00:00Z')
    expect(resolveQuotaPeriod({ type: 'rolling', hours: 0 }, now, SHANGHAI).startMs).toBe(
      now - HOUR_MS,
    )
    expect(resolveQuotaPeriod({ type: 'rolling', hours: 99_999 }, now, SHANGHAI).startMs).toBe(
      now - 8760 * HOUR_MS,
    )
  })

  it('永久累计从 0 开始且永不重置', () => {
    expect(resolveQuotaPeriod({ type: 'total' }, Date.now(), SHANGHAI)).toEqual({
      startMs: 0,
      endMs: null,
    })
  })
})

describe('describeQuotaWindow', () => {
  it('给出中文短描述', () => {
    expect(describeQuotaWindow({ type: 'calendar', period: 'day' })).toBe('每天')
    expect(describeQuotaWindow({ type: 'calendar', period: 'month' })).toBe('每月')
    expect(describeQuotaWindow({ type: 'rolling', hours: 5 })).toBe('滚动 5 小时')
    expect(describeQuotaWindow({ type: 'rolling', hours: 168 })).toBe('滚动 7 天')
    expect(describeQuotaWindow({ type: 'total' })).toBe('永久累计')
  })
})
