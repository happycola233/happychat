import { DEFAULT_REASONING_EFFORT_OPTIONS } from '../constants'
import type {
  ModelHardParams,
  ModelParams,
  ReasoningEffort,
  ReasoningEffortOption,
} from '../types/domain'

export interface AnthropicCapabilitySupport {
  supported?: boolean
}

export interface AnthropicCatalogCapabilities {
  image_input?: AnthropicCapabilitySupport
  pdf_input?: AnthropicCapabilitySupport
  thinking?: {
    supported?: boolean
    types?: {
      adaptive?: AnthropicCapabilitySupport
      enabled?: AnthropicCapabilitySupport
    }
  }
  effort?: {
    supported?: boolean
    low?: AnthropicCapabilitySupport
    medium?: AnthropicCapabilitySupport
    high?: AnthropicCapabilitySupport
    xhigh?: AnthropicCapabilitySupport
    max?: AnthropicCapabilitySupport
  }
}

export interface AnthropicModelProfile {
  preferredThinkingType: 'adaptive' | 'enabled' | null
  effortValues: string[]
  thinkingDefaultsOn: boolean
  canDisableThinking: boolean
  rejectsNonDefaultSampling: boolean
}

const ALL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const STANDARD_EFFORTS = ['low', 'medium', 'high', 'max']
const FULL_EFFORTS = [...ALL_EFFORTS]

function matchesModel(modelId: string, baseId: string): boolean {
  const id = modelId.toLowerCase()
  return id === baseId || id.startsWith(`${baseId}-`)
}

function knownAnthropicProfile(modelId: string): AnthropicModelProfile | null {
  const generationFiveAlwaysThinking =
    matchesModel(modelId, 'claude-fable-5') || matchesModel(modelId, 'claude-mythos-5')
  const generationFive =
    matchesModel(modelId, 'claude-sonnet-5') ||
    matchesModel(modelId, 'claude-opus-5') ||
    generationFiveAlwaysThinking
  const adaptiveOpus47Or48 =
    matchesModel(modelId, 'claude-opus-4-7') || matchesModel(modelId, 'claude-opus-4-8')
  if (generationFive || adaptiveOpus47Or48) {
    return {
      preferredThinkingType: 'adaptive',
      effortValues: FULL_EFFORTS,
      thinkingDefaultsOn: generationFive,
      canDisableThinking: !generationFiveAlwaysThinking,
      rejectsNonDefaultSampling: true,
    }
  }

  if (
    matchesModel(modelId, 'claude-opus-4-6') ||
    matchesModel(modelId, 'claude-sonnet-4-6') ||
    matchesModel(modelId, 'claude-mythos-preview')
  ) {
    return {
      preferredThinkingType: 'adaptive',
      effortValues: STANDARD_EFFORTS,
      thinkingDefaultsOn: matchesModel(modelId, 'claude-mythos-preview'),
      canDisableThinking: !matchesModel(modelId, 'claude-mythos-preview'),
      rejectsNonDefaultSampling: matchesModel(modelId, 'claude-mythos-preview'),
    }
  }

  if (matchesModel(modelId, 'claude-opus-4-5')) {
    return {
      preferredThinkingType: 'enabled',
      effortValues: ['low', 'medium', 'high'],
      thinkingDefaultsOn: false,
      canDisableThinking: true,
      rejectsNonDefaultSampling: false,
    }
  }

  if (
    matchesModel(modelId, 'claude-sonnet-4-5') ||
    matchesModel(modelId, 'claude-haiku-4-5') ||
    matchesModel(modelId, 'claude-opus-4-1') ||
    matchesModel(modelId, 'claude-opus-4-0') ||
    matchesModel(modelId, 'claude-sonnet-4-0') ||
    /^claude-(?:opus|sonnet)-4-\d{8}$/i.test(modelId) ||
    /^claude-3-7-sonnet(?:-|$)/i.test(modelId)
  ) {
    return {
      preferredThinkingType: 'enabled',
      effortValues: [],
      thinkingDefaultsOn: false,
      canDisableThinking: true,
      rejectsNonDefaultSampling: false,
    }
  }

  return null
}

/** Models API capabilities 优先；网关缺字段时只对官方已知 ID 使用精确回退。 */
export function anthropicModelProfile(
  modelId: string,
  capabilities?: AnthropicCatalogCapabilities | null,
): AnthropicModelProfile {
  const known = knownAnthropicProfile(modelId) ?? {
    preferredThinkingType: null,
    effortValues: [],
    thinkingDefaultsOn: false,
    canDisableThinking: true,
    rejectsNonDefaultSampling: false,
  }
  const thinkingCapabilities = capabilities?.thinking
  const effortCapabilities = capabilities?.effort

  let preferredThinkingType = known.preferredThinkingType
  if (thinkingCapabilities?.supported === false) {
    preferredThinkingType = null
  } else if (thinkingCapabilities) {
    const adaptiveSupported =
      thinkingCapabilities.types?.adaptive?.supported ?? known.preferredThinkingType === 'adaptive'
    const enabledSupported =
      thinkingCapabilities.types?.enabled?.supported ?? known.preferredThinkingType === 'enabled'
    preferredThinkingType = adaptiveSupported ? 'adaptive' : enabledSupported ? 'enabled' : null
  }

  let effortValues = known.effortValues
  if (effortCapabilities?.supported === false) {
    effortValues = []
  } else if (effortCapabilities) {
    effortValues = ALL_EFFORTS.filter(
      (value) => effortCapabilities[value]?.supported ?? known.effortValues.includes(value),
    )
  }

  return { ...known, preferredThinkingType, effortValues }
}

export function anthropicReasoningEffortOptions(
  profile: AnthropicModelProfile,
): ReasoningEffortOption[] {
  if (!profile.preferredThinkingType) return []
  const options = profile.canDisableThinking ? [DEFAULT_REASONING_EFFORT_OPTIONS[0]!] : []
  if (profile.effortValues.length > 0) {
    return [
      ...options,
      ...profile.effortValues.map(
        (value) =>
          DEFAULT_REASONING_EFFORT_OPTIONS.find((option) => option.value === value) ?? {
            value,
            description: value,
          },
      ),
    ].map((option) => ({ ...option }))
  }
  return [...options.map((option) => ({ ...option })), { value: 'enabled', description: '开启' }]
}

export function anthropicDefaultReasoningEffort(
  profile: AnthropicModelProfile,
): ReasoningEffort | null {
  if (!profile.preferredThinkingType) return null
  if (profile.effortValues.includes('high')) return 'high'
  return profile.effortValues[0] ?? 'enabled'
}

const ANTHROPIC_DOCUMENTED_MAX_OUTPUT_TOKENS_PRESET = 16_000

/** Anthropic thinking 指南使用的宽裕示例值；目录有更小模型上限时以目录为准。 */
export function anthropicDefaultMaxOutputTokens(reportedMaxTokens?: number): number {
  return typeof reportedMaxTokens === 'number' && reportedMaxTokens > 0
    ? Math.min(ANTHROPIC_DOCUMENTED_MAX_OUTPUT_TOKENS_PRESET, reportedMaxTokens)
    : ANTHROPIC_DOCUMENTED_MAX_OUTPUT_TOKENS_PRESET
}

export function hasAnthropicMaxOutputTokens(params: ModelParams | null | undefined): boolean {
  const value = params?.max_output_tokens
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export function hasAnthropicThinkingBudgetConflict(maxTokens: unknown, thinking: unknown): boolean {
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens)) return false
  if (typeof thinking !== 'object' || thinking === null || Array.isArray(thinking)) return false
  const config = thinking as Record<string, unknown>
  return (
    config.type === 'enabled' &&
    typeof config.budget_tokens === 'number' &&
    config.budget_tokens >= maxTokens
  )
}

/**
 * Anthropic Messages 的可见高级 JSON 模板。
 *
 * `thinking` 与 `tools` 是受界面开关管理的参数模板：仅在对应开关开启时进入请求。
 * 必填的 `max_tokens` 由默认参数栏中的 `max_output_tokens` 显式映射，不在这里重复配置。
 */
export function createAnthropicDefaultHardParams(
  modelId = 'claude-sonnet-5',
  capabilities?: AnthropicCatalogCapabilities | null,
  reportedMaxTokens?: number,
): ModelHardParams {
  const profile = anthropicModelProfile(modelId, capabilities)
  const maxTokens = anthropicDefaultMaxOutputTokens(reportedMaxTokens)
  const hardParams: ModelHardParams = {
    cache_control: {
      type: 'ephemeral',
    },
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
      },
    ],
  }
  if (profile.preferredThinkingType === 'adaptive') {
    hardParams.thinking = { type: 'adaptive', display: 'summarized' }
  } else if (profile.preferredThinkingType === 'enabled' && maxTokens > 1024) {
    hardParams.thinking = {
      type: 'enabled',
      budget_tokens: Math.min(8192, maxTokens - 1),
      display: 'summarized',
    }
  }
  return hardParams
}

export function anthropicDefaultHardParamsText(modelId: string): string {
  return JSON.stringify(createAnthropicDefaultHardParams(modelId), null, 2)
}
