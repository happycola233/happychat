import type { ModelCapabilities, ModelKind, ModelParams } from '../types/domain'

/** 检索类工具（web_search / x_search）开关计算所需的模型片段。 */
export interface SearchToolModelConfig {
  kind?: ModelKind
  capabilities: Pick<ModelCapabilities, 'web_search' | 'x_search'>
  defaultParams?: ModelParams | null
  defaultWebSearch?: boolean | null
  defaultXSearch?: boolean | null
}

/** 计算一次请求最终是否启用联网搜索，保持前后端与会话恢复口径一致。 */
export function effectiveWebSearchEnabled(
  model: SearchToolModelConfig | null | undefined,
  requestParams?: ModelParams | null,
): boolean {
  if (!model || model.kind === 'image' || !model.capabilities.web_search) return false
  return requestParams?.web_search ?? model.defaultParams?.web_search ?? model.defaultWebSearch ?? false
}

/**
 * 计算一次请求最终是否启用 X 搜索（xAI x_search）。
 * 与联网搜索相互独立、可同时开启；模型未声明该能力时恒为 false。
 */
export function effectiveXSearchEnabled(
  model: SearchToolModelConfig | null | undefined,
  requestParams?: ModelParams | null,
): boolean {
  if (!model || model.kind === 'image' || !model.capabilities.x_search) return false
  return requestParams?.x_search ?? model.defaultParams?.x_search ?? model.defaultXSearch ?? false
}
