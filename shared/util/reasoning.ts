import type { ModelCapabilities, ModelKind, ModelParams, ReasoningEffort } from '../types/domain'

export interface ReasoningModelConfig {
  kind?: ModelKind
  capabilities: Pick<ModelCapabilities, 'reasoning'>
  allowedEfforts?: readonly ReasoningEffort[] | null
  defaultParams?: ModelParams | null
  defaultEffort?: ReasoningEffort | null
}

function canUseReasoning(model: ReasoningModelConfig | null | undefined): model is ReasoningModelConfig {
  return Boolean(model && model.kind !== 'image' && model.capabilities.reasoning)
}

export function isReasoningEffortAllowed(
  model: ReasoningModelConfig | null | undefined,
  effort: ReasoningEffort | null | undefined,
): effort is ReasoningEffort {
  if (!canUseReasoning(model) || !effort) return false
  return (model.allowedEfforts ?? []).includes(effort)
}

export function effectiveReasoningEffort(
  model: ReasoningModelConfig | null | undefined,
  requestParams?: ModelParams | null,
): ReasoningEffort | null {
  if (!canUseReasoning(model)) return null
  const candidates = [
    requestParams?.reasoning_effort,
    model.defaultParams?.reasoning_effort,
    model.defaultEffort,
  ]
  return candidates.find((effort) => isReasoningEffortAllowed(model, effort)) ?? null
}

export function isReasoningEnabled(
  model: ReasoningModelConfig | null | undefined,
  requestParams?: ModelParams | null,
): boolean {
  const effort = effectiveReasoningEffort(model, requestParams)
  return Boolean(effort && effort !== 'none')
}
