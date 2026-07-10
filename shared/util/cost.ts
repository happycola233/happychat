import type { ModelPricing } from '../types/domain'

export interface CostTokens {
  inputTokens: number
  cacheWriteTokens: number
  cachedTokens: number
  outputTokens: number
  imageTokens: number
}

const PER_MILLION = 1_000_000

/**
 * 估算单条用量的成本（USD）。规则：
 * - 普通输入 (input - cache write - cache read) 按 input 价
 * - 缓存写入按 cacheWriteInput 价（未配置则回退 input 价）
 * - 缓存读取按 cachedInput 价（未配置则回退 input 价，即不打折）
 * - 输出（含 reasoning，二者计费一致）按 output 价
 * - 图片 token 按 image 价
 * pricing 为空时总成本为 0；输出/图片价格未配置时相应部分不计。
 */
export function costUsd(tokens: CostTokens, pricing: ModelPricing | null | undefined): number {
  if (!pricing) return 0
  // details 是 inputTokens 的互斥子集。防御性裁剪兼容字段异常的 OpenAI 兼容上游，
  // 避免缓存明细之和偶尔大于总输入时重复计费。
  const totalInput = Math.max(0, tokens.inputTokens)
  const cacheReadTokens = Math.min(totalInput, Math.max(0, tokens.cachedTokens))
  const cacheWriteTokens = Math.min(
    totalInput - cacheReadTokens,
    Math.max(0, tokens.cacheWriteTokens),
  )
  const uncachedInput = totalInput - cacheReadTokens - cacheWriteTokens
  let cost = 0
  if (pricing.input) cost += (uncachedInput * pricing.input) / PER_MILLION
  const cacheWritePrice = pricing.cacheWriteInput ?? pricing.input
  if (cacheWritePrice) cost += (cacheWriteTokens * cacheWritePrice) / PER_MILLION
  const cachedPrice = pricing.cachedInput ?? pricing.input
  if (cachedPrice) cost += (cacheReadTokens * cachedPrice) / PER_MILLION
  if (pricing.output) cost += (tokens.outputTokens * pricing.output) / PER_MILLION
  if (pricing.image) cost += (tokens.imageTokens * pricing.image) / PER_MILLION
  return cost
}
