import { REASONING_MIN_OUTPUT_TOKENS } from '@shared/constants'
import type { ModelParams } from '@shared/types/domain'
import { effectiveReasoningEffort } from '@shared/util/reasoning'
import { effectiveWebSearchEnabled } from '@shared/util/webSearch'
import type { models } from '../db/schema'
import { applyPromptCacheKey } from './promptCache'

type ModelRow = typeof models.$inferSelect

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const WEB_SEARCH_TOOL_TYPES = new Set(['web_search', 'web_search_preview'])

function responseToolMergeKey(tool: unknown): string | null {
  if (!isPlainObject(tool) || typeof tool.type !== 'string') return null
  if (WEB_SEARCH_TOOL_TYPES.has(tool.type)) return 'web_search'
  if (tool.type === 'function' && typeof tool.name === 'string') return `function:${tool.name}`
  if (tool.type === 'mcp' && typeof tool.server_label === 'string')
    return `mcp:${tool.server_label}`
  if (tool.type === 'namespace' && typeof tool.name === 'string') return `namespace:${tool.name}`

  // 内置工具通常是单例配置；高级 JSON 中同一工具仍应覆盖应用生成的默认配置。
  if (
    [
      'code_interpreter',
      'computer_use_preview',
      'file_search',
      'image_generation',
      'shell',
      'tool_search',
    ].includes(tool.type)
  ) {
    return tool.type
  }
  return null
}

function mergeResponseTools(existing: unknown[], overrides: unknown[]): unknown[] {
  const merged = [...existing]
  const indexByKey = new Map<string, number>()

  for (const [index, tool] of merged.entries()) {
    const key = responseToolMergeKey(tool)
    if (key) indexByKey.set(key, index)
  }

  for (const tool of overrides) {
    const key = responseToolMergeKey(tool)
    const existingIndex = key ? indexByKey.get(key) : undefined
    if (existingIndex !== undefined) {
      merged[existingIndex] = tool
    } else {
      if (key) indexByKey.set(key, merged.length)
      merged.push(tool)
    }
  }

  return merged
}

/** Responses include 是字符串集合；高级参数只能补充，不能覆盖应用要求的回传字段。 */
function mergeResponseIncludes(existing: unknown[], overrides: unknown[]): unknown[] {
  return [...new Set([...existing, ...overrides])]
}

export function mergeDeep(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    const existing = target[k]
    if (k === 'tools' && Array.isArray(existing) && Array.isArray(v) && v.length > 0) {
      target[k] = mergeResponseTools(existing, v)
    } else if (k === 'include' && Array.isArray(existing) && Array.isArray(v)) {
      target[k] = mergeResponseIncludes(existing, v)
    } else if (isPlainObject(v) && isPlainObject(existing)) mergeDeep(existing, v)
    else target[k] = v
  }
}

export interface BuildBodyOptions {
  model: ModelRow
  input: unknown[]
  instructions: string | null
  userParams?: ModelParams | null
  stream: boolean
  promptCacheKey?: string
}

/**
 * 构建上游 /responses 请求体。
 * 参数优先级：管理员硬参数 > 用户请求参数 > 模型默认 > 代码默认。
 * 默认 store=false（本地重放，不发 previous_response_id）；高级 JSON 可显式覆盖。
 */
export function buildResponseBody(o: BuildBodyOptions): Record<string, unknown> {
  const { model, input, instructions, userParams, stream, promptCacheKey } = o
  const defaults = model.defaultParams ?? {}
  const body: Record<string, unknown> = { model: model.modelId, input, stream }

  if (instructions) body.instructions = instructions

  const temperature = userParams?.temperature ?? defaults.temperature
  if (temperature !== undefined) body.temperature = temperature
  const topP = userParams?.top_p ?? defaults.top_p
  if (topP !== undefined) body.top_p = topP
  const verbosity = userParams?.verbosity ?? defaults.verbosity
  if (verbosity !== undefined) body.text = { verbosity }
  const tools: Record<string, unknown>[] = []

  // 思考：按当前模型 allowedEfforts 从用户请求、模型默认中选择第一个有效值。
  const effort = effectiveReasoningEffort(model, userParams)
  if (effort) {
    body.reasoning = { effort }
  }
  if (model.replayReasoning && effort && effort !== 'none') {
    body.include = ['reasoning.encrypted_content']
  }

  // 联网搜索：仅当模型支持且开关开启
  if (effectiveWebSearchEnabled(model, userParams)) {
    tools.push({ type: 'web_search' })
  }

  if (tools.length > 0) body.tools = tools

  // max_output_tokens：开启思考时保证下限预算
  let maxOut = userParams?.max_output_tokens ?? defaults.max_output_tokens
  if (effort && effort !== 'none') maxOut = Math.max(maxOut ?? 0, REASONING_MIN_OUTPUT_TOKENS)
  if (maxOut !== undefined && maxOut > 0) body.max_output_tokens = maxOut

  // 应用默认值先写入；高级 JSON 最终合并，可显式覆盖 key 并透传任意上游参数。
  body.store = false
  applyPromptCacheKey(body, promptCacheKey)
  if (isPlainObject(model.hardParams)) mergeDeep(body, model.hardParams)
  return body
}

/** 构建 /images/generations 请求体（gpt-image-2 等图片模型）。 */
export function buildImageBody(
  model: ModelRow,
  prompt: string,
  userParams?: ModelParams | null,
): Record<string, unknown> {
  return buildImageRequestBody(model, prompt, userParams)
}

export function buildImageEditBody(
  model: ModelRow,
  prompt: string,
  imageUrls: string[],
  userParams?: ModelParams | null,
): Record<string, unknown> {
  return {
    ...buildImageRequestBody(model, prompt, userParams),
    images: imageUrls.map((imageUrl) => ({ image_url: imageUrl })),
  }
}

function buildImageRequestBody(
  model: ModelRow,
  prompt: string,
  userParams?: ModelParams | null,
): Record<string, unknown> {
  const defaults = model.defaultParams ?? {}
  const body: Record<string, unknown> = { model: model.modelId, prompt, n: 1 }
  const size = userParams?.image?.size ?? defaults.image?.size
  if (size) body.size = size
  const quality = userParams?.image?.quality ?? defaults.image?.quality
  if (quality) body.quality = quality
  const background = userParams?.image?.background ?? defaults.image?.background
  if (background) body.background = background
  if (isPlainObject(model.hardParams)) mergeDeep(body, model.hardParams)
  return body
}
