import type { ModelCapabilities, ModelKind } from '../types/domain'

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

/**
 * 按执行协议收敛能力位。Chat Completions 路径不提供站内的 Web/X Search 工具，
 * 即使旧记录或客户端仍携带历史配置，也不能继续把它们暴露成可用能力。
 */
export function normalizeModelCapabilitiesForKind(
  kind: ModelKind,
  capabilities: Partial<ModelCapabilities> | null | undefined,
): ModelCapabilities {
  const normalized = normalizeModelCapabilities(capabilities)
  if (kind !== 'chat') return normalized
  return { ...normalized, web_search: false, x_search: false }
}
