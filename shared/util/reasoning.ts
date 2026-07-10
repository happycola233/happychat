import { defaultReasoningEffortDescription } from '../constants'
import type {
  ModelCapabilities,
  ModelKind,
  ModelParams,
  ReasoningEffort,
  ReasoningEffortOption,
  StoredReasoningEffortOption,
} from '../types/domain'

export interface ReasoningModelConfig {
  kind?: ModelKind
  capabilities: Pick<ModelCapabilities, 'reasoning'>
  allowedEfforts?: readonly StoredReasoningEffortOption[] | null
  defaultParams?: ModelParams | null
  defaultEffort?: ReasoningEffort | null
}

/**
 * 上游枚举值必须是一个可见、连续的 token。
 * 除常规空白外一并拦截 Unicode 控制/格式字符，避免零宽字符和双向文本控制造成同形配置。
 */
export function isSafeReasoningEffortValue(value: string): boolean {
  return value.length > 0 && !/[\p{White_Space}\p{C}\p{Default_Ignorable_Code_Point}]/u.test(value)
}

/**
 * 把 allowed_efforts 的旧字符串数组或新对象数组规范成唯一的公开形态。
 * 这里刻意只做兼容清洗，不补齐任何档位，避免覆盖管理员为特定模型配置的子集和顺序。
 */
export function normalizeReasoningEffortOptions(
  options: readonly StoredReasoningEffortOption[] | null | undefined,
): ReasoningEffortOption[] {
  if (!Array.isArray(options)) return []

  const normalized: ReasoningEffortOption[] = []
  const seen = new Set<string>()
  for (const option of options) {
    const value = (typeof option === 'string' ? option : option?.value)?.trim()
    if (!value || seen.has(value)) continue

    const configuredDescription =
      typeof option === 'string' ? '' : (option.description?.trim() ?? '')
    normalized.push({
      value,
      description: configuredDescription || defaultReasoningEffortDescription(value),
    })
    seen.add(value)
  }
  return normalized
}

/** 按上游 value 取模型配置的展示信息。 */
export function findReasoningEffortOption(
  options: readonly StoredReasoningEffortOption[] | null | undefined,
  effort: ReasoningEffort | null | undefined,
): ReasoningEffortOption | null {
  if (!effort) return null
  return normalizeReasoningEffortOptions(options).find((option) => option.value === effort) ?? null
}

function canUseReasoning(model: ReasoningModelConfig | null | undefined): model is ReasoningModelConfig {
  return Boolean(model && model.kind !== 'image' && model.capabilities.reasoning)
}

export function isReasoningEffortAllowed(
  model: ReasoningModelConfig | null | undefined,
  effort: ReasoningEffort | null | undefined,
): effort is ReasoningEffort {
  if (!canUseReasoning(model) || !effort) return false
  return findReasoningEffortOption(model.allowedEfforts, effort) !== null
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
