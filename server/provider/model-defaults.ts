import { DEFAULT_REASONING_EFFORT_OPTIONS } from '@shared/constants'
import type {
  ModelCapabilities,
  ModelHardParams,
  ModelKind,
  ReasoningEffort,
  ReasoningEffortOption,
} from '@shared/types/domain'

export interface InferredModelDefaults {
  kind: ModelKind
  capabilities: ModelCapabilities
  allowedEfforts: ReasoningEffortOption[]
  defaultEffort: ReasoningEffort | null
  hardParams: ModelHardParams
  defaultWebSearch: boolean
}

const MODELS_SUPPORTING_MAX_EFFORT = new Set([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
])

/**
 * 同步模型时为「新模型」推断合理默认配置（管理员后续可修改）。
 * 启发式：含 image → 图片模型；含 gpt-5 → 视为多模态思考模型。
 */
export function inferModelDefaults(modelId: string): InferredModelDefaults {
  const id = modelId.toLowerCase()

  if (id.includes('image')) {
    return {
      kind: 'image',
      capabilities: {
        vision: true,
        file_input: false,
        web_search: false,
        image_generation: true,
        reasoning: false,
      },
      allowedEfforts: [],
      defaultEffort: null,
      hardParams: {},
      defaultWebSearch: false,
    }
  }

  const reasoning = id.includes('gpt-5') || id.startsWith('o')
  // 仅为上游明确列出的三款 GPT-5.6 模型预置 max；未知变体仍可由管理员手动配置。
  const supportsMaxEffort = MODELS_SUPPORTING_MAX_EFFORT.has(id)
  const allowedEfforts = DEFAULT_REASONING_EFFORT_OPTIONS.filter(
    (option) => supportsMaxEffort || option.value !== 'max',
  ).map((option) => ({ ...option }))
  return {
    kind: 'responses',
    capabilities: {
      vision: true,
      file_input: true,
      web_search: true,
      image_generation: false,
      reasoning,
    },
    allowedEfforts: reasoning ? allowedEfforts : [],
    // GPT-5.5/5.6 默认 medium；其余思考模型给一个保守默认，管理员可调。
    defaultEffort: reasoning
      ? id.includes('5.5') || supportsMaxEffort
        ? 'medium'
        : 'low'
      : null,
    // 管理员硬参数：思考模型固定 summary='auto' 以展示官方思考摘要
    hardParams: reasoning ? { reasoning: { summary: 'auto' } } : {},
    defaultWebSearch: false,
  }
}
