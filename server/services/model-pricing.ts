import { eq } from 'drizzle-orm'
import type { ExchangeRateSnapshot, ModelKind, ModelPricing } from '@shared/types/domain'
import { createRequestPricingSnapshot, normalizeModelPricing } from '@shared/util/cost'
import { db } from '../db/client'
import { models } from '../db/schema'
import { getExchangeRate, requireExchangeRate, storedExchangeRate } from './exchange-rates'

type PricedModel = { kind: ModelKind; pricing: ModelPricing | null }

/** 请求开始时冻结引用价格。后续改价、删除来源模型都不影响本次结算。 */
export function resolveModelPricing(model: PricedModel): ModelPricing {
  const current = createRequestPricingSnapshot(model.pricing, model.kind)
  if (!current.imagePricingModelId) return current
  const source = db.select().from(models).where(eq(models.id, current.imagePricingModelId)).get()
  const { imagePricingModelId: _sourceId, ...snapshot } = current
  if (source?.kind === 'image') {
    snapshot.imageGeneration = normalizeModelPricing(source.pricing, 'image').imageGeneration
    snapshot.imagePricingSnapshot = normalizeModelPricing(source.pricing, 'image')
  }
  return snapshot
}

function needsExchangeRate(snapshot: ModelPricing): boolean {
  return snapshot.currency === 'CNY' || snapshot.imagePricingSnapshot?.currency === 'CNY'
}

/** 有人民币价目时必须取得汇率；纯美元价目只在已有汇率时顺带冻结，便于折算展示。 */
async function exchangeRateFor(snapshots: ModelPricing[]): Promise<ExchangeRateSnapshot | null> {
  if (snapshots.some(needsExchangeRate)) return requireExchangeRate()
  return storedExchangeRate() ? getExchangeRate() : null
}

/** 在创建请求前冻结价格及汇率，避免外部汇率故障留下未执行的 run。 */
export async function freezeModelPricing(model: PricedModel): Promise<ModelPricing> {
  const snapshot = resolveModelPricing(model)
  const rate = await exchangeRateFor([snapshot])
  return rate ? { ...snapshot, exchangeRate: rate } : snapshot
}

/**
 * 同时冻结用户计价与单独设置了成本价的线路，并共用同一份汇率快照。
 * 未单独设置成本价的线路不出现在 costByRoute 中，结算时直接使用用户计价快照。
 */
export async function freezeRunPricing(
  model: PricedModel,
  routes: { id: string; costPricing: ModelPricing | null }[],
): Promise<{ billing: ModelPricing; costByRoute: Map<string, ModelPricing> }> {
  const billing = resolveModelPricing(model)
  const costs = routes.flatMap((route) =>
    route.costPricing
      ? [{ id: route.id, snapshot: createRequestPricingSnapshot(route.costPricing, model.kind) }]
      : [],
  )
  const rate = await exchangeRateFor([billing, ...costs.map((cost) => cost.snapshot)])
  const withRate = (snapshot: ModelPricing) =>
    rate ? { ...snapshot, exchangeRate: rate } : snapshot
  return {
    billing: withRate(billing),
    costByRoute: new Map(costs.map((cost) => [cost.id, withRate(cost.snapshot)])),
  }
}

/** Responses 模型可引用任意纯生图模型的价格核算生图工具费用；引用只影响核价。 */
export function validImagePricingSource(
  pricing: ModelPricing | null | undefined,
  kind: ModelKind,
): boolean {
  if (!pricing?.imagePricingModelId) return true
  if (kind !== 'responses') return false
  const source = db.select().from(models).where(eq(models.id, pricing.imagePricingModelId)).get()
  return source?.kind === 'image'
}
