import { eq } from 'drizzle-orm'
import type { ModelKind, ModelPricing } from '@shared/types/domain'
import { createRequestPricingSnapshot, normalizeModelPricing } from '@shared/util/cost'
import { db } from '../db/client'
import { models } from '../db/schema'
import { getExchangeRate, requireExchangeRate, storedExchangeRate } from './exchange-rates'

type PricedModel = { kind: ModelKind; providerId: string; pricing: ModelPricing | null }

/** 请求开始时冻结引用价格。后续改价、删除来源模型都不影响本次结算。 */
export function resolveModelPricing(model: PricedModel): ModelPricing {
  const current = createRequestPricingSnapshot(model.pricing, model.kind)
  if (!current.imagePricingModelId) return current
  const source = db.select().from(models).where(eq(models.id, current.imagePricingModelId)).get()
  const { imagePricingModelId: _sourceId, ...snapshot } = current
  if (source?.providerId === model.providerId && source.kind === 'image') {
    snapshot.imageGeneration = normalizeModelPricing(source.pricing, 'image').imageGeneration
    snapshot.imagePricingSnapshot = normalizeModelPricing(source.pricing, 'image')
  }
  return snapshot
}

/** 在创建请求前冻结价格及汇率，避免外部汇率故障留下未执行的 run。 */
export async function freezeModelPricing(model: PricedModel): Promise<ModelPricing> {
  const snapshot = resolveModelPricing(model)
  const needsRate = snapshot.currency === 'CNY' || snapshot.imagePricingSnapshot?.currency === 'CNY'
  const rate = needsRate
    ? await requireExchangeRate()
    : storedExchangeRate()
      ? await getExchangeRate()
      : null
  return rate ? { ...snapshot, exchangeRate: rate } : snapshot
}

export function validImagePricingSource(
  pricing: ModelPricing | null | undefined,
  providerId: string,
  kind: ModelKind,
): boolean {
  if (!pricing?.imagePricingModelId) return true
  if (kind !== 'responses') return false
  const source = db.select().from(models).where(eq(models.id, pricing.imagePricingModelId)).get()
  return source?.providerId === providerId && source.kind === 'image'
}
