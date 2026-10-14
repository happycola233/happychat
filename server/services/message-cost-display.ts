import type { AppConfigDTO, MessageCostDisplayDTO } from '@shared/types/api'
import {
  getExchangeRate,
  legacyExchangeRate,
  resetExchangeRateCacheForTests,
} from './exchange-rates'

export const resetMessageCostDisplayCacheForTests = resetExchangeRateCacheForTests
export async function getUsdToCnyRate(): Promise<number | null> {
  return (await getExchangeRate())?.usdToCny ?? null
}

/** 新账读取自身汇率；旧账使用首次取得的固定折算基准。 */
export async function getMessageCostDisplay(
  config: Pick<AppConfigDTO, 'showCost' | 'costCurrency'>,
): Promise<MessageCostDisplayDTO> {
  if (!config.showCost || config.costCurrency === 'USD')
    return { currency: config.costCurrency, usdToCnyRate: null }
  await getExchangeRate()
  const legacy = legacyExchangeRate()
  return {
    currency: 'CNY',
    usdToCnyRate: legacy?.usdToCny ?? null,
    ...(legacy ? { legacyRateAt: legacy.fetchedAt } : {}),
  }
}
