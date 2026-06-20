import type { ModelCapabilities, ModelKind, ModelParams } from '../types/domain'

export interface WebSearchModelConfig {
  kind?: ModelKind
  capabilities: Pick<ModelCapabilities, 'web_search'>
  defaultParams?: ModelParams | null
  defaultWebSearch?: boolean | null
}

/** 计算一次请求最终是否启用联网搜索，保持前后端与会话恢复口径一致。 */
export function effectiveWebSearchEnabled(
  model: WebSearchModelConfig | null | undefined,
  requestParams?: ModelParams | null,
): boolean {
  if (!model || model.kind === 'image' || !model.capabilities.web_search) return false
  return requestParams?.web_search ?? model.defaultParams?.web_search ?? model.defaultWebSearch ?? false
}
