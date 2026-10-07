import type { ImageGenerationUsage } from '@shared/types/domain'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function setting(value: unknown): string | null {
  return typeof value === 'string' && value !== 'auto' && value.length > 0 ? value : null
}

/** Images API 用量与兼容供应商的工具级 usage 共用解析；不借用 Responses 顶层聊天用量。 */
export function parseImageGenerationUsage(
  value: unknown,
  imageCount: number,
  metadata: Record<string, unknown>,
  request: Record<string, unknown> = {},
): ImageGenerationUsage {
  const usage = record(value)
  const input = record(usage.input_tokens_details)
  const output = record(usage.output_tokens_details)
  const cached = record(input.cached_tokens_details)
  const totalInput = tokenCount(usage.input_tokens)
  const imageInput = tokenCount(input.image_tokens)
  const textInput = tokenCount(input.text_tokens)
  return {
    model: setting(metadata.model) ?? setting(request.model),
    imageCount,
    size: setting(metadata.size) ?? setting(request.size),
    quality: setting(metadata.quality) ?? setting(request.quality),
    textInputTokens:
      textInput ??
      (totalInput === 0
        ? 0
        : totalInput !== null && imageInput !== null
          ? Math.max(0, totalInput - imageInput)
          : null),
    imageInputTokens:
      imageInput ??
      (totalInput === 0
        ? 0
        : totalInput !== null && textInput !== null
          ? Math.max(0, totalInput - textInput)
          : null),
    imageOutputTokens: tokenCount(output.image_tokens) ?? tokenCount(usage.output_tokens),
    cachedTextInputTokens: tokenCount(cached.text_tokens) ?? 0,
    cachedImageInputTokens: tokenCount(cached.image_tokens) ?? 0,
  }
}

export function imageToolRequest(body: Record<string, unknown>): Record<string, unknown> {
  return Array.isArray(body.tools)
    ? record(body.tools.find((tool: unknown) => record(tool).type === 'image_generation'))
    : {}
}
