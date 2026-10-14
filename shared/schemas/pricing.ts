import { z } from 'zod'
import { pricingPeriodIntervals } from '../util/pricing'

export const priceSchema = z.number().nonnegative('单价不能为负数').finite('请输入有效单价')
export const tokenPricingShape = {
  input: priceSchema.optional(),
  output: priceSchema.optional(),
  cachedInput: priceSchema.optional(),
  cacheWriteInput: priceSchema.optional(),
}
export const contextTiersSchema = z
  .array(
    z.object({
      aboveInputTokens: z.number().int('Token 阈值必须是整数').positive('Token 阈值必须大于 0'),
      ...tokenPricingShape,
    }),
  )
  .max(20, '最多设置 20 个上下文档位')
  .superRefine((tiers, ctx) => {
    const seen = new Set<number>()
    tiers.forEach((tier, index) => {
      if (seen.has(tier.aboveInputTokens))
        ctx.addIssue({
          code: 'custom',
          path: [index, 'aboveInputTokens'],
          message: '输入 Token 阈值不能重复',
        })
      seen.add(tier.aboveInputTokens)
    })
  })

export const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}, '请输入有效时区，例如 Asia/Shanghai')
export const pricingTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '请填写有效时间')
export const pricingEndTimeSchema = z
  .string()
  .regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/, '请填写有效结束时间，例如 08:00 或 24:00')

export function validatePricingPeriods(
  periods: { weekdays: number[]; start: string; end: string }[],
  ctx: z.RefinementCtx,
) {
  const ranges: { start: number; end: number }[] = []
  periods.forEach((period, index) => {
    if (period.start === period.end)
      ctx.addIssue({ code: 'custom', path: [index, 'end'], message: '全天请填写 00:00–24:00' })
    for (const [start, end] of pricingPeriodIntervals(period)) {
      if (ranges.some((other) => start < other.end && end > other.start)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'start'],
          message: '时段不能重叠，请调整时间或星期',
        })
        break
      }
      ranges.push({ start, end })
    }
  })
}
