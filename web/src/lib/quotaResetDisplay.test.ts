import { describe, expect, it } from 'vitest'
import type { QuotaBucketUsageDTO } from '@shared/types/api'
import { describeQuotaReset, quotaResetKey } from './quotaResetDisplay'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-08-18T04:00:00.000Z')

const rule = (
  patch: Partial<Pick<QuotaBucketUsageDTO, 'limit' | 'window' | 'periodActive' | 'periodEnd'>> = {},
) => ({
  limit: { kind: 'amount' as const, value: 10 },
  window: { type: 'calendar' as const, period: 'month' as const },
  periodActive: true,
  periodEnd: NOW + 4 * DAY,
  ...patch,
})

describe('describeQuotaReset', () => {
  it('豁免没有重置文案', () => {
    expect(describeQuotaReset(rule({ limit: { kind: 'unlimited' } }), NOW)).toBeNull()
  })

  it('永久累计、未启动与滚动窗口不伪造重置时刻', () => {
    expect(describeQuotaReset(rule({ window: { type: 'total' }, periodEnd: null }), NOW)).toEqual({
      kind: 'never',
      label: '不会重置',
    })
    expect(
      describeQuotaReset(
        rule({ window: { type: 'anchored', hours: 5 }, periodActive: false, periodEnd: null }),
        NOW,
      ),
    ).toEqual({ kind: 'pending', label: '首次请求后开始' })
    expect(
      describeQuotaReset(rule({ window: { type: 'rolling', hours: 5 }, periodEnd: null }), NOW),
    ).toEqual({ kind: 'rolling', label: '随时间释放' })
  })

  it('固定边界用相对时间，并带上绝对时刻供悬停', () => {
    expect(describeQuotaReset(rule({ periodEnd: NOW - 1 }), NOW)).toMatchObject({
      kind: 'scheduled',
      label: '即将重置',
    })
    expect(describeQuotaReset(rule({ periodEnd: NOW + 30 * 60_000 }), NOW)).toMatchObject({
      kind: 'scheduled',
      label: '30 分钟后重置',
    })
    expect(describeQuotaReset(rule({ periodEnd: NOW + 13 * HOUR }), NOW)).toMatchObject({
      kind: 'scheduled',
      label: '13 小时后重置',
    })
    const fourDays = describeQuotaReset(rule({ periodEnd: NOW + 4 * DAY + 2 * HOUR }), NOW)
    expect(fourDays).toMatchObject({ kind: 'scheduled', label: '4 天后重置' })
    expect(fourDays?.detail).toMatch(/月.*日/)
  })

  it('同一重置时刻的独立桶共用同一把钥匙', () => {
    const left = rule({ periodEnd: NOW + 4 * DAY })
    const right = rule({ periodEnd: NOW + 4 * DAY })
    expect(quotaResetKey(left, NOW)).toBe(quotaResetKey(right, NOW))
    expect(quotaResetKey(left, NOW)).not.toBe(
      quotaResetKey(rule({ periodEnd: NOW + 5 * DAY }), NOW),
    )
  })
})
