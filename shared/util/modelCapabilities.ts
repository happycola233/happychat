import type { ModelCapabilities } from '../types/domain'

/**
 * 能力位是逐步追加的：历史入库记录只包含当时存在的键（例如 2026-07 之前没有 `x_search`）。
 * 读库与出参统一走这里补齐，避免调用方拿到 `undefined` 却按 boolean 处理。
 */
export function normalizeModelCapabilities(
  capabilities: Partial<ModelCapabilities> | null | undefined,
): ModelCapabilities {
  return {
    vision: Boolean(capabilities?.vision),
    file_input: Boolean(capabilities?.file_input),
    web_search: Boolean(capabilities?.web_search),
    x_search: Boolean(capabilities?.x_search),
    image_generation: Boolean(capabilities?.image_generation),
    reasoning: Boolean(capabilities?.reasoning),
  }
}
