import { describe, expect, it } from 'vitest'
import type { ModelPricing, PricingPeriod } from '../types/domain'
import { pricingSchema } from '../schemas/model-config'
import { calculateRequestCost } from './cost'
import { selectPricingTable } from './pricing'

const tokens = (inputTokens: number, outputTokens = 1000) => ({
  inputTokens,
  outputTokens,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  imageTokens: 0,
})
const period: PricingPeriod = {
  id: 'peak',
  label: '高峰',
  weekdays: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '12:00',
  pricing: {
    input: 4,
    output: 8,
    contextTiers: [{ aboveInputTokens: 128000, input: 6, output: 12 }],
  },
}
const pricing: ModelPricing = {
  currency: 'CNY',
  timezone: 'Asia/Shanghai',
  input: 1,
  output: 2,
  periods: [period],
  exchangeRate: { usdToCny: 7, fetchedAt: 1 },
  contextTiers: [{ aboveInputTokens: 128000, input: 3, output: 6 }],
}
const at = (value: string) => new Date(value).getTime()

describe('分时、上下文与双币种核价', () => {
  it('时段开始包含、结束不包含；时区与星期共同生效', () => {
    expect(selectPricingTable(pricing, at('2026-10-12T00:59:59Z')).period).toBe('基础价格')
    expect(selectPricingTable(pricing, at('2026-10-12T01:00:00Z')).period).toBe('高峰')
    expect(selectPricingTable(pricing, at('2026-10-12T04:00:00Z')).period).toBe('基础价格')
    expect(selectPricingTable(pricing, at('2026-10-11T01:00:00Z')).period).toBe('基础价格')
  })
  it('跨午夜归属开始的星期，周日跨到周一亦可匹配', () => {
    const schedule = {
      ...pricing,
      timezone: 'UTC',
      periods: [{ ...period, weekdays: [7], start: '23:00', end: '02:00' }],
    }
    expect(selectPricingTable(schedule, at('2026-10-12T01:59:00Z')).period).toBe('高峰')
    expect(selectPricingTable(schedule, at('2026-10-12T02:00:00Z')).period).toBe('基础价格')
  })
  it('夏令时使用 IANA 时区，指定日期全天采用基础价', () => {
    const schedule = { ...pricing, timezone: 'America/New_York' }
    expect(selectPricingTable(schedule, at('2026-07-13T13:00:00Z')).period).toBe('高峰')
    expect(selectPricingTable(schedule, at('2026-12-14T14:00:00Z')).period).toBe('高峰')
    expect(
      selectPricingTable({ ...pricing, excludedDates: ['2026-10-12'] }, at('2026-10-12T01:00:00Z'))
        .period,
    ).toBe('基础价格')
  })
  it('严格超过输入阈值才换档，整次输入与输出采用所属时段的独立单价', () => {
    const start = at('2026-10-12T01:00:00Z')
    expect(calculateRequestCost(tokens(128000), pricing, 'chat', [], start).totalCny).toBeCloseTo(
      0.52,
    )
    const result = calculateRequestCost(tokens(128001), pricing, 'chat', [], start)
    expect(result.totalCny).toBeCloseTo(0.780006)
    expect(result.totalUsd).toBeCloseTo(0.780006 / 7)
    expect(result.charges?.[0]).toMatchObject({
      period: '高峰',
      aboveInputTokens: 128000,
      currency: 'CNY',
    })
  })
  it('按输入总量含缓存选档，命中后的缓存价格可单独为零', () => {
    const result = calculateRequestCost(
      { ...tokens(200000), cachedTokens: 150000 },
      {
        ...pricing,
        contextTiers: [{ aboveInputTokens: 128000, input: 3, output: 6, cachedInput: 0 }],
      },
      'chat',
      [],
      at('2026-10-12T12:00:00Z'),
    )
    expect(result.totalCny).toBeCloseTo(0.156)
  })
  it('续跑/重试分别选档并可跨时段，不把累加输入当成长上下文', () => {
    const result = calculateRequestCost(
      {
        ...tokens(200000, 2000),
        billingSegments: [
          { ...tokens(100000), startedAt: at('2026-10-12T03:59:00Z') },
          { ...tokens(100000), startedAt: at('2026-10-12T04:01:00Z') },
        ],
      },
      pricing,
      'chat',
      [],
    )
    expect(result.totalCny).toBeCloseTo(0.51)
    expect(result.charges?.map((charge) => charge.aboveInputTokens)).toEqual([undefined, undefined])
  })
  it('聊天和引用生图价目表可有不同币种和时段', () => {
    const result = calculateRequestCost(
      tokens(1_000_000, 0),
      {
        currency: 'USD',
        input: 1,
        exchangeRate: { usdToCny: 7, fetchedAt: 1 },
        imagePricingSnapshot: {
          currency: 'CNY',
          timezone: 'UTC',
          imageGeneration: { mode: 'per_image', price: 2 },
          periods: [{ ...period, pricing: { imageGeneration: { mode: 'per_image', price: 7 } } }],
        },
      },
      'responses',
      [
        {
          model: null,
          imageCount: 2,
          size: null,
          quality: null,
          textInputTokens: null,
          imageInputTokens: null,
          imageOutputTokens: null,
          cachedTextInputTokens: 0,
          cachedImageInputTokens: 0,
        },
      ],
      at('2026-10-12T10:00:00Z'),
    )
    expect(result.totalUsd).toBe(3)
    expect(result.totalCny).toBe(21)
    expect(result.charges?.map((charge) => charge.currency)).toEqual(['USD', 'CNY'])
  })
  it('拒绝重叠时段（含跨周）、重复档位、无效时区；相邻时段合法', () => {
    const valid = { periods: [period, { ...period, id: 'second', start: '12:00', end: '14:00' }] }
    expect(pricingSchema.safeParse(valid).success).toBe(true)
    expect(
      pricingSchema.safeParse({ periods: [period, { ...period, id: 'second', start: '11:00' }] })
        .success,
    ).toBe(false)
    expect(
      pricingSchema.safeParse({
        periods: [
          { ...period, weekdays: [7], start: '23:00', end: '02:00' },
          { ...period, weekdays: [1], start: '01:00', end: '03:00' },
        ],
      }).success,
    ).toBe(false)
    expect(pricingSchema.safeParse({ timezone: 'invalid' }).success).toBe(false)
    expect(
      pricingSchema.safeParse({
        contextTiers: [{ aboveInputTokens: 100 }, { aboveInputTokens: 100 }],
      }).success,
    ).toBe(false)
  })
})
