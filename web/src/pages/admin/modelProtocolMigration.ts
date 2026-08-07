import type { ModelKind, ModelParams, ProviderProtocol } from '@shared/types/domain'
import { createAnthropicDefaultHardParams } from '@shared/util/anthropic'

function parseHardParams(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed === '{}') return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function isToolWithType(tool: unknown, types: Set<string>): boolean {
  return (
    typeof tool === 'object' &&
    tool !== null &&
    !Array.isArray(tool) &&
    typeof (tool as { type?: unknown }).type === 'string' &&
    types.has((tool as { type: string }).type)
  )
}

function isAnthropicWebSearchTool(tool: unknown): boolean {
  if (typeof tool !== 'object' || tool === null || Array.isArray(tool)) return false
  const candidate = tool as { type?: unknown }
  return typeof candidate.type === 'string' && candidate.type.startsWith('web_search_')
}

/** 跨到 Anthropic 时只迁移已知协议字段；自定义字段与工具保持可见、原样保留。 */
export function migrateHardParamsToAnthropic(text: string, modelId: string): string {
  const current = parseHardParams(text)
  if (!current) return text
  const migrated = { ...current }
  for (const key of ['reasoning', 'include', 'prompt_cache_key', 'max_output_tokens', 'store']) {
    delete migrated[key]
  }
  const openAiToolTypes = new Set(['web_search', 'x_search'])
  const retainedTools = Array.isArray(migrated.tools)
    ? migrated.tools.filter((tool) => !isToolWithType(tool, openAiToolTypes))
    : []
  delete migrated.tools
  const preset = createAnthropicDefaultHardParams(modelId)
  const presetTools = retainedTools.some(isAnthropicWebSearchTool)
    ? []
    : ((preset.tools as unknown[]) ?? [])
  return JSON.stringify(
    {
      ...preset,
      ...migrated,
      tools: [...presetTools, ...retainedTools],
    },
    null,
    2,
  )
}

export function migrateHardParamsFromAnthropic(text: string, nextKind: ModelKind): string {
  const current = parseHardParams(text)
  if (!current) return text
  const migrated = { ...current }
  for (const key of ['cache_control', 'thinking', 'output_config']) delete migrated[key]
  if (
    nextKind === 'chat' &&
    migrated.max_completion_tokens === undefined &&
    migrated.max_tokens !== undefined
  ) {
    migrated.max_completion_tokens = migrated.max_tokens
  }
  delete migrated.max_tokens
  if (Array.isArray(migrated.tools)) {
    const remainingTools = migrated.tools.filter((tool) => !isAnthropicWebSearchTool(tool))
    if (remainingTools.length > 0) migrated.tools = remainingTools
    else delete migrated.tools
  }
  return Object.keys(migrated).length ? JSON.stringify(migrated, null, 2) : ''
}

export function migrateDefaultParamsToAnthropic(
  params: ModelParams,
  defaultMaxOutputTokens: number,
): { params: ModelParams; autoFilledMaxOutputTokens: boolean } {
  if (params.max_output_tokens !== undefined) {
    return { params, autoFilledMaxOutputTokens: false }
  }
  return {
    params: { ...params, max_output_tokens: defaultMaxOutputTokens },
    autoFilledMaxOutputTokens: true,
  }
}

/** 离开 Anthropic 时只移除本次切换自动填入、且用户未编辑过的输出上限。 */
export function migrateDefaultParamsFromAnthropic(
  params: ModelParams,
  removeAutoFilledMaxOutputTokens: boolean,
): ModelParams {
  if (!removeAutoFilledMaxOutputTokens) return params
  const migrated = { ...params }
  delete migrated.max_output_tokens
  return migrated
}

/** Provider 协议决定可用引擎；同协议切换保持当前 kind，从而不触发请求模板迁移。 */
export function modelKindForProviderProtocol(
  currentKind: ModelKind,
  protocol: ProviderProtocol,
): ModelKind {
  if (protocol === 'anthropic') return 'anthropic'
  return currentKind === 'anthropic' ? 'responses' : currentKind
}
