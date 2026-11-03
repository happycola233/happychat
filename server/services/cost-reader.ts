import type { CostBasis, CostCurrency, ModelPricing } from '@shared/types/domain'
import { costUsd, costCny, type CostTokens } from '@shared/util/cost'
import { legacyExchangeRate, requireExchangeRate } from './exchange-rates'

/** 聚合行里可选的上游真实成本合计；迁移前只有一套价格，缺失时与计费金额相同。 */
export interface CostReaderRow extends CostTokens {
  upstreamCostUsd?: number | null
  upstreamCostCny?: number | null
}

export type CostReader = (tokens: CostReaderRow, pricing: ModelPricing | null | undefined) => number

/**
 * 同一次统计使用同一份旧账基准；新账直接读取请求结束时冻结的双币种金额。
 * basis=upstream 读取按线路成本价结算的上游真实成本，billed 读取用户计费金额。
 */
export async function getCostReader(
  currency: CostCurrency = 'USD',
  basis: CostBasis = 'billed',
): Promise<CostReader> {
  let read: CostReader = costUsd
  if (currency === 'CNY') {
    await requireExchangeRate()
    const legacyRate = legacyExchangeRate()!.usdToCny
    read = (tokens, pricing) => costCny(tokens, pricing, legacyRate)
  }
  if (basis === 'billed') return read
  return (tokens, pricing) =>
    tokens.upstreamCostUsd == null
      ? read(tokens, pricing)
      : read(
          { ...tokens, costUsd: tokens.upstreamCostUsd, costCny: tokens.upstreamCostCny },
          pricing,
        )
}
