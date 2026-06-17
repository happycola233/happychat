import type { ModelCapabilities, ModelKind, ModelParams, ReasoningEffort } from '../types/domain'

export interface ReasoningModelConfig {
  kind?: ModelKind
  capabilities: Pick<ModelCapabilities, 'reasoning'>
  defaultParams?: ModelParams | null
  defaultEffort?: ReasoningEffort | null
}

export function effectiveReasoningEffort(
  model: ReasoningModelConfig | null | undefined,
  requestParams?: ModelParams | null,
): ReasoningEffort | null {
  if (!model || model.kind === 'image' || !model.capabilities.reasoning) return null
  return (
    requestParams?.reasoning_effort ??
    model.defaultParams?.reasoning_effort ??
    model.defaultEffort ??
    null
  )
}

export function isReasoningEnabled(
  model: ReasoningModelConfig | null | undefined,
  requestParams?: ModelParams | null,
): boolean {
  const effort = effectiveReasoningEffort(model, requestParams)
  return Boolean(effort && effort !== 'none')
}
