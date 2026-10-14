import type { CostCurrency, ModelPricing } from '@shared/types/domain'
import { costUsd, costCny, type CostTokens } from '@shared/util/cost'
import { legacyExchangeRate, requireExchangeRate } from './exchange-rates'

export type CostReader = (tokens: CostTokens, pricing: ModelPricing | null | undefined) => number

/** 同一次统计使用同一份旧账基准；新账直接读取请求结束时冻结的双币种金额。 */
export async function getCostReader(currency: CostCurrency = 'USD'): Promise<CostReader> {
  if (currency === 'USD') return costUsd
  await requireExchangeRate()
  const legacyRate = legacyExchangeRate()!.usdToCny
  return (tokens, pricing) => costCny(tokens, pricing, legacyRate)
}
