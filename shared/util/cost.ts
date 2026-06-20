import type { ModelPricing } from '../types/domain'

export interface CostTokens {
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  imageTokens: number
}

const PER_MILLION = 1_000_000

/**
 * 估算单条用量的成本（USD）。规则：
 * - 未缓存输入 (input - cached) 按 input 价
 * - 缓存输入按 cachedInput 价（未配置则回退 input 价，即不打折）
 * - 输出（含 reasoning，二者计费一致）按 output 价
 * - 图片 token 按 image 价
 * pricing 为空、或对应价格项未配置时，该部分计 0。
 */
export function costUsd(tokens: CostTokens, pricing: ModelPricing | null | undefined): number {
  if (!pricing) return 0
  const uncachedInput = Math.max(0, tokens.inputTokens - tokens.cachedTokens)
  let cost = 0
  if (pricing.input) cost += (uncachedInput * pricing.input) / PER_MILLION
  const cachedPrice = pricing.cachedInput ?? pricing.input
  if (cachedPrice) cost += (tokens.cachedTokens * cachedPrice) / PER_MILLION
  if (pricing.output) cost += (tokens.outputTokens * pricing.output) / PER_MILLION
  if (pricing.image) cost += (tokens.imageTokens * pricing.image) / PER_MILLION
  return cost
}
