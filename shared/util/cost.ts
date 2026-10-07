import type {
  ImageGenerationPricing,
  ImageGenerationUsage,
  ModelKind,
  ModelPricing,
  RequestCostBreakdown,
} from '../types/domain'

export interface CostTokens {
  /** 已结算的新请求优先使用冻结成本；旧记录仍由价格快照回算。 */
  costUsd?: number | null
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
  if (tokens.costUsd != null) return tokens.costUsd
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

/** 只升级当前配置，历史快照继续按旧口径读取。旧生图输出价格不再叠加两次。 */
export function normalizeModelPricing(
  pricing: ModelPricing | null | undefined,
  kind: ModelKind,
): ModelPricing {
  const { image, ...current } = pricing ?? {}
  if (
    !current.imageGeneration &&
    !current.imagePricingModelId &&
    (kind === 'image' || image != null)
  ) {
    current.imageGeneration =
      kind === 'image'
        ? {
            mode: 'tokens',
            textInput: current.input,
            imageInput: current.input,
            imageOutput: image ?? current.output,
            cachedTextInput: current.cachedInput,
            cachedImageInput: current.cachedInput,
          }
        : { mode: 'tokens', imageOutput: image }
  }
  if (kind === 'image') return { imageGeneration: current.imageGeneration }
  if (kind !== 'responses')
    return {
      input: current.input,
      output: current.output,
      cachedInput: current.cachedInput,
      cacheWriteInput: current.cacheWriteInput,
    }
  return current
}

function imageUnitPrice(
  pricing: Extract<ImageGenerationPricing, { mode: 'per_image' }>,
  usage: ImageGenerationUsage,
): { price?: number; status: RequestCostBreakdown['imageStatus'] } {
  const candidates = (pricing.tiers ?? []).filter(
    (tier) =>
      (!tier.size || !usage.size || tier.size === usage.size) &&
      (!tier.quality || !usage.quality || tier.quality === usage.quality),
  )
  // auto 未回显具体档位时，不能把可能更贵的图片悄悄按默认价结算。
  if (candidates.some((tier) => (tier.size && !usage.size) || (tier.quality && !usage.quality)))
    return { status: 'missing_usage' }
  candidates.sort(
    (a, b) =>
      Number(Boolean(b.size)) * 2 +
      Number(Boolean(b.quality)) -
      (Number(Boolean(a.size)) * 2 + Number(Boolean(a.quality))),
  )
  const price = candidates[0]?.price ?? pricing.price
  return { price, status: price == null ? 'missing_pricing' : 'complete' }
}

export function calculateRequestCost(
  tokens: CostTokens,
  pricing: ModelPricing | null | undefined,
  kind: ModelKind,
  images: ImageGenerationUsage[],
): RequestCostBreakdown {
  const current = normalizeModelPricing(pricing, kind)
  const chatUsd =
    kind === 'image' ? 0 : costUsd({ ...tokens, costUsd: null, imageTokens: 0 }, current)
  const result: RequestCostBreakdown = {
    chatUsd,
    imageUsd: 0,
    totalUsd: chatUsd,
    imageCount: 0,
    imageStatus: 'complete',
  }
  const imagePricing = current.imageGeneration
  const addTokens = (count: number | null, price: number | undefined) => {
    if (count === null) result.imageStatus = 'missing_usage'
    else if (count > 0 && price == null && result.imageStatus !== 'missing_usage')
      result.imageStatus = 'missing_pricing'
    if (count !== null && price != null) result.imageUsd += (count * price) / PER_MILLION
  }
  for (const usage of images) {
    result.imageCount += usage.imageCount
    if (!imagePricing) {
      result.imageStatus = 'missing_pricing'
    } else if (imagePricing.mode === 'per_image') {
      if (usage.imageCount === 0) continue
      const { price, status } = imageUnitPrice(imagePricing, usage)
      if (status !== 'complete' && result.imageStatus !== 'missing_usage')
        result.imageStatus = status
      if (price != null) result.imageUsd += usage.imageCount * price
    } else {
      const cachedText = Math.min(usage.textInputTokens ?? 0, usage.cachedTextInputTokens)
      const cachedImage = Math.min(usage.imageInputTokens ?? 0, usage.cachedImageInputTokens)
      addTokens(
        usage.textInputTokens === null ? null : usage.textInputTokens - cachedText,
        imagePricing.textInput,
      )
      addTokens(
        usage.imageInputTokens === null ? null : usage.imageInputTokens - cachedImage,
        imagePricing.imageInput,
      )
      addTokens(cachedText, imagePricing.cachedTextInput ?? imagePricing.textInput)
      addTokens(cachedImage, imagePricing.cachedImageInput ?? imagePricing.imageInput)
      addTokens(usage.imageOutputTokens, imagePricing.imageOutput)
    }
  }
  result.totalUsd += result.imageUsd
  return result
}
