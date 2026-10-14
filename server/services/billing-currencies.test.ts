import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelPricing, QuotaRule } from '@shared/types/domain'
import { calculateRequestCost } from '@shared/util/cost'
import { evaluateQuotaLimit } from '@shared/util/quota'

let directory: string
let client: typeof import('../db/client')
let schema: typeof import('../db/schema')
let rates: typeof import('./exchange-rates')
let pricing: typeof import('./model-pricing')
let quota: typeof import('./quota')
let quotaAdmin: typeof import('./quota-admin')
let stats: typeof import('./stats')
let usage: typeof import('./usage-stats')
const tokens = {
  inputTokens: 1_000_000,
  outputTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  imageTokens: 0,
}
const rule = (id: string, currency: 'USD' | 'CNY', value: number): QuotaRule => ({
  id,
  currency,
  label: null,
  metric: 'cost',
  limit: { kind: 'amount', value },
  scope: { type: 'all' },
  window: { type: 'total' },
  priority: 0,
})

beforeAll(async () => {
  mkdirSync('.tmp', { recursive: true })
  directory = mkdtempSync(join(process.cwd(), '.tmp', 'billing-currencies-'))
  process.env.DATA_DIR = directory
  process.env.DATABASE_URL = join(directory, 'test.db')
  process.env.NODE_ENV = 'test'
  vi.resetModules()
  client = await import('../db/client')
  schema = await import('../db/schema')
  ;(await import('../db/migrate')).runMigrations()
  rates = await import('./exchange-rates')
  pricing = await import('./model-pricing')
  quota = await import('./quota')
  quotaAdmin = await import('./quota-admin')
  stats = await import('./stats')
  usage = await import('./usage-stats')
  await (await import('./appConfig')).updateAppConfig({ quotaEnabled: true })
  client.db
    .insert(schema.users)
    .values({ id: 'u', username: 'billing-test', passwordHash: 'test' })
    .run()
  client.db
    .insert(schema.providers)
    .values({ id: 'p', name: 'Billing test', baseUrl: 'https://example.test', apiKey: 'test' })
    .run()
  client.db
    .insert(schema.models)
    .values({
      id: 'm',
      providerId: 'p',
      modelId: 'billing',
      displayName: 'Billing model',
      capabilities: {
        vision: false,
        file_input: false,
        web_search: false,
        x_search: false,
        image_generation: false,
        reasoning: false,
      },
      pricing: { currency: 'CNY', input: 7 },
    })
    .run()
  client.db.insert(schema.quotaPolicies).values({ id: 'q', name: 'Billing quota', rules: [] }).run()
  client.db.insert(schema.userQuotas).values({ userId: 'u', policyId: 'q' }).run()
})
beforeEach(() => {
  rates.resetExchangeRateCacheForTests()
  client.db.delete(schema.exchangeRates).run()
  client.db.delete(schema.usageLogs).run()
  client.db.delete(schema.quotaAdjustments).run()
  client.db
    .update(schema.quotaPolicies)
    .set({ rules: [rule('usd', 'USD', 3), rule('cny', 'CNY', 21)] })
    .run()
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { currency: 'USD', rates: { CNY: '7' } } })),
      ),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
afterAll(() => {
  client.sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

async function log(nativePricing: ModelPricing) {
  const snapshot = await pricing.freezeModelPricing({
    kind: 'chat',
    providerId: 'p',
    pricing: nativePricing,
  })
  const cost = calculateRequestCost(tokens, snapshot, 'chat', [], Date.now())
  client.db
    .insert(schema.usageLogs)
    .values({
      userId: 'u',
      modelId: 'm',
      providerId: 'p',
      kind: 'chat',
      success: true,
      ...tokens,
      totalTokens: tokens.inputTokens,
      pricingSnapshot: snapshot,
      costUsd: cost.totalUsd,
      costCny: cost.totalCny,
      costBreakdown: cost,
    })
    .run()
  return cost
}

describe('双币种账单与额度的一致性', () => {
  it('混合原币与旧账在额度、事件、概览、个人统计中一致，汇率刷新不改写历史', async () => {
    await rates.requireExchangeRate()
    await log({ currency: 'USD', input: 1 })
    await log({ currency: 'CNY', input: 7 })
    // 迁移前只有美元成本：以首次取得的固定基准换算。
    client.db
      .insert(schema.usageLogs)
      .values({ userId: 'u', modelId: 'm', kind: 'chat', success: true, costUsd: 1 })
      .run()
    const snapshot = await quota.getQuotaSnapshot('u')
    expect(
      snapshot.rules.map((bucket) => [bucket.currency ?? 'USD', bucket.used, bucket.blocked]),
    ).toEqual([
      ['USD', 3, true],
      ['CNY', 21, true],
    ])
    expect((await stats.getOverview({ userId: 'u', currency: 'CNY' })).totals.cost).toBe(21)
    expect(
      (await stats.listUsageEvents({ userId: 'u', currency: 'CNY' })).items.map(
        (event) => event.cost,
      ),
    ).toEqual([7, 7, 7])
    expect((await usage.getMyUsageStats('u', { currency: 'CNY' })).totals.cost).toBe(21)

    client.db
      .update(schema.exchangeRates)
      .set({ fetchedAt: new Date(0) })
      .run()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: { currency: 'USD', rates: { CNY: '8' } } })),
        ),
    )
    expect((await rates.requireExchangeRate()).usdToCny).toBe(8)
    expect(rates.legacyExchangeRate()?.usdToCny).toBe(7)
    expect((await stats.getOverview({ userId: 'u', currency: 'CNY' })).totals.cost).toBe(21)
    expect((await quota.getQuotaSnapshot('u')).rules[1]!.used).toBe(21)
    expect((await log({ currency: 'USD', input: 1 })).totalCny).toBe(8)
    expect((await usage.getMyUsageStats('u', { currency: 'CNY' })).totals.cost).toBe(29)
    expect((await stats.getOverview({ userId: 'u', currency: 'USD' })).totals.cost).toBe(4)
  })

  it('临时额度保留发放币种和汇率，策略改币种后保持等值', async () => {
    await rates.requireExchangeRate()
    const grant = await quotaAdmin.createQuotaGrant('u', { ruleId: 'cny', amount: 7 }, 'u')
    expect(grant).toMatchObject({ ok: true, grant: { currency: 'CNY', amount: 7 } })
    client.db.update(schema.exchangeRates).set({ usdToCny: 8 }).run()
    client.db
      .update(schema.quotaPolicies)
      .set({ rules: [rule('cny', 'USD', 3)] })
      .run()
    const bucket = (await quota.getQuotaSnapshot('u')).rules[0]
    expect(bucket).toMatchObject({ granted: 1, effectiveLimit: 4 })
    expect(bucket?.currency ?? 'USD').toBe('USD')
  })

  it('首次汇率失败阻止人民币请求；有持久化汇率时网络失败仍按原值结算', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(
      pricing.freezeModelPricing({
        kind: 'chat',
        providerId: 'p',
        pricing: { currency: 'CNY', input: 7 },
      }),
    ).rejects.toMatchObject({ status: 503 })
    client.db
      .insert(schema.exchangeRates)
      .values({ id: 1, usdToCny: 7, fetchedAt: new Date(0), legacyRate: 7, legacyAt: new Date(0) })
      .run()
    rates.resetExchangeRateCacheForTests()
    expect((await log({ currency: 'CNY', input: 7 })).totalUsd).toBe(1)
  })

  it('引用生图价目表在请求创建后改价，不改变已经冻结的币种和原价', async () => {
    client.db
      .update(schema.models)
      .set({
        kind: 'image',
        pricing: { currency: 'CNY', imageGeneration: { mode: 'per_image', price: 7 } },
      })
      .where(eq(schema.models.id, 'm'))
      .run()
    const frozen = await pricing.freezeModelPricing({
      kind: 'responses',
      providerId: 'p',
      pricing: { currency: 'USD', imagePricingModelId: 'm', input: 1 },
    })
    client.db
      .update(schema.models)
      .set({ pricing: { currency: 'USD', imageGeneration: { mode: 'per_image', price: 100 } } })
      .where(eq(schema.models.id, 'm'))
      .run()
    const cost = calculateRequestCost(tokens, frozen, 'responses', [
      {
        model: null,
        imageCount: 1,
        size: null,
        quality: null,
        textInputTokens: null,
        imageInputTokens: null,
        imageOutputTokens: null,
        cachedTextInputTokens: 0,
        cachedImageInputTokens: 0,
      },
    ])
    expect(cost.totalUsd).toBe(2)
    expect(cost.totalCny).toBe(14)
    expect(cost.charges?.[1]).toMatchObject({ currency: 'CNY', amount: 7 })
  })

  it('换算与累计产生的浮点尾数不放行一笔额外请求', () => {
    expect(
      evaluateQuotaLimit({ limit: { kind: 'amount', value: 0.8 }, used: 0.1 + 0.7 }),
    ).toMatchObject({ blocked: true, remaining: 0 })
    expect(
      evaluateQuotaLimit({ limit: { kind: 'amount', value: 0.8 }, used: 0.79999 }).blocked,
    ).toBe(false)
  })
})
