import { describe, expect, it } from 'vitest'
import type { ImageGenerationUsage, ModelPricing } from '../types/domain'
import { calculateRequestCost, costUsd, normalizeModelPricing } from './cost'
import { pricingSchema } from '../schemas/model-config'

const tokens = {
  inputTokens: 1000,
  cacheWriteTokens: 0,
  cachedTokens: 0,
  outputTokens: 1000,
  imageTokens: 1000,
}
const image: ImageGenerationUsage = {
  model: 'image-test',
  imageCount: 1,
  size: '1024x1024',
  quality: 'high',
  textInputTokens: 1000,
  imageInputTokens: 2000,
  imageOutputTokens: 3000,
  cachedTextInputTokens: 200,
  cachedImageInputTokens: 1000,
}
const pricing: ModelPricing = {
  input: 10,
  output: 50,
  imageGeneration: {
    mode: 'tokens',
    textInput: 5,
    imageInput: 8,
    imageOutput: 30,
    cachedTextInput: 1,
    cachedImageInput: 2,
  },
}

describe('independent image generation pricing', () => {
  it('charges tool input and image output separately from chat output', () => {
    const cost = calculateRequestCost(tokens, pricing, 'responses', [image])
    expect(cost.chatUsd).toBeCloseTo(0.06)
    expect(cost.imageUsd).toBeCloseTo(0.1042)
    expect(cost.totalUsd).toBeCloseTo(0.1642)
    expect(cost.imageStatus).toBe('complete')
  })
  it('pure image generation never adds chat input or output prices', () => {
    expect(calculateRequestCost(tokens, pricing, 'image', [image]).totalUsd).toBeCloseTo(0.1042)
  })
  it('per-image fees include image inputs and outputs and work without usage', () => {
    const unknown = {
      ...image,
      imageCount: 2,
      textInputTokens: null,
      imageInputTokens: null,
      imageOutputTokens: null,
    }
    const perImage: ModelPricing = {
      ...pricing,
      imageGeneration: { mode: 'per_image', price: 0.05 },
    }
    expect(calculateRequestCost(tokens, perImage, 'responses', [unknown])).toMatchObject({
      imageUsd: 0.1,
      imageStatus: 'complete',
    })
    expect(calculateRequestCost(tokens, perImage, 'responses', [unknown]).chatUsd).toBeCloseTo(0.06)
    expect(calculateRequestCost(tokens, perImage, 'image', [unknown]).totalUsd).toBe(0.1)
    expect(
      calculateRequestCost(tokens, perImage, 'image', [{ ...unknown, imageCount: 0 }]).totalUsd,
    ).toBe(0)
  })
  it('uses exact, size, quality then default prices and preserves explicit zero', () => {
    const perImage: ModelPricing = {
      imageGeneration: {
        mode: 'per_image',
        price: 0.01,
        tiers: [
          { quality: 'high', price: 0.02 },
          { size: '1024x1024', price: 0.03 },
          { size: '1024x1024', quality: 'high', price: 0.04 },
          { quality: 'low', price: 0 },
        ],
      },
    }
    const cases = [
      [image, 0.04],
      [{ ...image, quality: 'medium' }, 0.03],
      [{ ...image, size: '1536x1024' }, 0.02],
      [{ ...image, size: '1536x1024', quality: 'medium' }, 0.01],
      [{ ...image, size: '1536x1024', quality: 'low' }, 0],
    ] as const
    for (const [usage, expected] of cases)
      expect(calculateRequestCost(tokens, perImage, 'image', [usage]).totalUsd).toBe(expected)
    expect(
      calculateRequestCost(tokens, perImage, 'image', [{ ...image, size: null }]).imageStatus,
    ).toBe('missing_usage')
  })
  it.each([undefined, 'USD', 'CNY'] as const)(
    'charges one image fee per request with %s pricing across multiple tools and retries',
    (currency) => {
      const perRequest: ModelPricing = {
        ...pricing,
        currency,
        ...(currency && { exchangeRate: { usdToCny: 7, fetchedAt: 1 } }),
        imageGeneration: { mode: 'per_request', price: 0.05 },
      }
      const unknown = {
        ...image,
        size: null,
        quality: null,
        textInputTokens: null,
        imageInputTokens: null,
        imageOutputTokens: null,
      }
      const images = [
        { ...unknown, imageCount: 0, startedAt: 1 },
        { ...unknown, imageCount: 2, startedAt: 1 },
        { ...unknown, imageCount: 1, startedAt: 2 },
      ]
      const cost = calculateRequestCost(tokens, perRequest, 'responses', images)
      const rate = currency === 'CNY' ? 7 : 1
      expect(cost.chatUsd).toBeCloseTo(0.06 / rate)
      expect(cost.imageUsd).toBeCloseTo(0.05 / rate)
      expect(cost.totalUsd).toBeCloseTo(0.11 / rate)
      expect(cost).toMatchObject({ imageCount: 3, imageStatus: 'complete' })
      if (currency)
        expect(cost.charges?.filter((charge) => charge.kind === 'image')).toHaveLength(1)
      expect(calculateRequestCost(tokens, perRequest, 'image', images).totalUsd).toBeCloseTo(
        0.05 / rate,
      )
      // 单价按请求结算，下一条请求仍需收取自己的费用。
      expect(calculateRequestCost(tokens, perRequest, 'responses', [unknown]).imageUsd).toBeCloseTo(
        0.05 / rate,
      )
      for (const noImages of [[], [{ ...unknown, imageCount: 0 }]]) {
        expect(calculateRequestCost(tokens, perRequest, 'responses', noImages)).toMatchObject({
          imageUsd: 0,
          imageCount: 0,
          imageStatus: 'complete',
        })
      }
    },
  )
  it.each([undefined, 'USD'] as const)(
    'distinguishes free and unconfigured request prices (%s)',
    (currency) => {
      for (const price of [undefined, 0]) {
        const cost = calculateRequestCost(
          tokens,
          { currency, imageGeneration: { mode: 'per_request', price } },
          'responses',
          [image, image],
        )
        expect(cost).toMatchObject({
          imageUsd: 0,
          imageCount: 2,
          imageStatus: price == null ? 'missing_pricing' : 'complete',
        })
      }
    },
  )
  it('missing image usage stays incomplete and never borrows chat output tokens', () => {
    const cost = calculateRequestCost(tokens, pricing, 'responses', [
      { ...image, imageOutputTokens: null },
    ])
    expect(cost.imageStatus).toBe('missing_usage')
    expect(cost.imageUsd).toBeCloseTo(0.0142)
    expect(calculateRequestCost(tokens, {}, 'responses', [image]).imageStatus).toBe(
      'missing_pricing',
    )
  })
  it('normalizes live legacy image prices without revaluing historical snapshots', () => {
    const legacy = { input: 2, output: 30, image: 40 }
    expect(normalizeModelPricing(legacy, 'image')).toMatchObject({
      imageGeneration: { mode: 'tokens', textInput: 2, imageInput: 2, imageOutput: 40 },
    })
    expect(costUsd(tokens, legacy)).toBeCloseTo(0.072)
    expect(costUsd({ ...tokens, costUsd: 0 }, legacy)).toBe(0)
    expect(costUsd({ ...tokens, costUsd: 0.1 }, null)).toBe(0.1)
  })
  it('rejects conflicting sources, negative prices and duplicate tiers at the boundary', () => {
    expect(
      pricingSchema.safeParse({ imageGeneration: { mode: 'per_request', price: 0 } }).success,
    ).toBe(true)
    expect(
      pricingSchema.safeParse({ imageGeneration: { mode: 'per_request', price: -1 } }).success,
    ).toBe(false)
    expect(
      pricingSchema.safeParse({ imageGeneration: { mode: 'per_image', price: -1 } }).success,
    ).toBe(false)
    expect(
      pricingSchema.safeParse({ imagePricingModelId: 'other', imageGeneration: { mode: 'tokens' } })
        .success,
    ).toBe(false)
    expect(
      pricingSchema.safeParse({
        imageGeneration: {
          mode: 'per_image',
          tiers: [
            { size: '1024x1024', price: 1 },
            { size: '1024x1024', price: 2 },
          ],
        },
      }).success,
    ).toBe(false)
  })
})
