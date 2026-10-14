import type { PricingPeriod, PricingSchedule, PricingTable, TokenPricing } from '../types/domain'

export const PRICING_TIMEZONE = 'Asia/Shanghai'
export const pricingMinute = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours! * 60 + minutes!
}

/** 一周内的半开区间；跨午夜归属起始星期，周日溢出拆到周一。 */
export function pricingPeriodIntervals(
  period: Pick<PricingPeriod, 'weekdays' | 'start' | 'end'>,
): [number, number][] {
  const start = pricingMinute(period.start)
  const end = pricingMinute(period.end)
  return period.weekdays.flatMap((weekday): [number, number][] => {
    const from = (weekday - 1) * 1440 + start
    const to = (weekday - 1) * 1440 + end + (end <= start ? 1440 : 0)
    return to > 10080
      ? [
          [from, 10080],
          [0, to - 10080],
        ]
      : [[from, to]]
  })
}

export function selectPricingTable(
  schedule: PricingSchedule,
  at: number,
): { table: PricingTable; period: string } {
  if (!schedule.periods?.length) return { table: schedule, period: '基础价格' }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone ?? PRICING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const value = (key: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === key)!.value
  const date = `${value('year')}-${value('month')}-${value('day')}`
  if (schedule.excludedDates?.includes(date)) return { table: schedule, period: '基础价格' }
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7
  const minute = (day - 1) * 1440 + Number(value('hour')) * 60 + Number(value('minute'))
  const period = schedule.periods.find((item) =>
    pricingPeriodIntervals(item).some(([start, end]) => minute >= start && minute < end),
  )
  return period
    ? { table: period.pricing, period: period.label }
    : { table: schedule, period: '基础价格' }
}

export function selectTokenPricing(
  table: PricingTable,
  inputTokens: number,
): { prices: TokenPricing; aboveInputTokens?: number } {
  const tier = table.contextTiers
    ?.filter((item) => inputTokens > item.aboveInputTokens)
    .sort((a, b) => b.aboveInputTokens - a.aboveInputTokens)[0]
  // 每档是独立单价；缺省缓存读取跟随该档输入价，缓存写入缺省为 0。
  return tier ? { prices: tier, aboveInputTokens: tier.aboveInputTokens } : { prices: table }
}
