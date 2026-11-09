import type { ModelParams } from '@shared/types/domain'
import { imageModelProfile, resolveImageOptions } from '@shared/util/imageOptions'
import { effectiveReasoningEffort } from '@shared/util/reasoning'
import { effectiveWebSearchEnabled, effectiveXSearchEnabled } from '@shared/util/searchTools'
import type { models } from '../db/schema'
import { applyPromptCacheKey } from './promptCache'

export type RequestModelConfig = Pick<
  typeof models.$inferSelect,
  | 'modelId'
  | 'kind'
  | 'capabilities'
  | 'defaultParams'
  | 'hardParams'
  | 'allowedEfforts'
  | 'defaultEffort'
  | 'replayProviderContext'
  | 'defaultWebSearch'
  | 'defaultXSearch'
>

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const WEB_SEARCH_TOOL_TYPES = new Set(['web_search', 'web_search_preview'])

/**
 * 启停由应用开关（能力位 + 会话开关 + 模型默认）决定的工具。
 * 高级 JSON 里的同名条目只是「参数模板」：开关开启时合并进去，关闭时整条丢弃。
 */
const TOGGLE_MANAGED_TOOL_KEYS = new Set(['web_search', 'x_search'])

function responseToolMergeKey(tool: unknown): string | null {
  if (!isPlainObject(tool) || typeof tool.type !== 'string') return null
  if (WEB_SEARCH_TOOL_TYPES.has(tool.type)) return 'web_search'
  if (tool.type === 'x_search') return 'x_search'
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
      // 浅合并：管理员只写想改的字段，应用生成的配置作为底稿。
      const base = merged[existingIndex]
      merged[existingIndex] =
        isPlainObject(base) && isPlainObject(tool) ? { ...base, ...tool } : tool
      continue
    }
    // 开关关闭 → 应用没生成这个工具 → 高级 JSON 里的参数模板本轮不生效。
    // 否则「关闭联网搜索」会被一份只想调参数的高级 JSON 悄悄推翻。
    if (key && TOGGLE_MANAGED_TOOL_KEYS.has(key)) continue
    if (key) indexByKey.set(key, merged.length)
    merged.push(tool)
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
    if (k === 'tools' && Array.isArray(v)) {
      // 显式空数组 = 清空全部工具（管理员兜底）。
      if (v.length === 0) {
        target[k] = []
        continue
      }
      // 应用没生成任何工具时也要走合并：开关型工具的模板要在这里被丢弃，
      // 而不是让整个数组原样落到请求体上。
      const tools = mergeResponseTools(Array.isArray(existing) ? existing : [], v)
      if (tools.length === 0) delete target[k]
      else target[k] = tools
    } else if (k === 'include' && Array.isArray(existing) && Array.isArray(v)) {
      target[k] = mergeResponseIncludes(existing, v)
    } else if (isPlainObject(v) && isPlainObject(existing)) mergeDeep(existing, v)
    else target[k] = v
  }
}

export interface BuildBodyOptions {
  model: RequestModelConfig
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
  if (model.replayProviderContext && effort && effort !== 'none') {
    body.include = ['reasoning.encrypted_content']
  }

  // 联网搜索 / X 搜索：是否下发只由开关决定；工具自身的参数（如 xAI 的
  // enable_image_search）由高级 JSON 里的同名条目在 mergeDeep 阶段合并进来。
  if (effectiveWebSearchEnabled(model, userParams)) {
    tools.push({ type: 'web_search' })
  }
  // X 搜索（xAI x_search）：与联网搜索独立，可同时下发
  if (effectiveXSearchEnabled(model, userParams)) {
    tools.push({ type: 'x_search' })
  }

  if (tools.length > 0) body.tools = tools

  // 输出上限包含思考与正文；未配置时沿用上游默认，不因开启思考而暗设或抬高上限。
  const maxOutputTokens = userParams?.max_output_tokens ?? defaults.max_output_tokens
  if (maxOutputTokens !== undefined) body.max_output_tokens = maxOutputTokens

  // 应用默认值先写入；高级 JSON 最终合并，可显式覆盖 key 并透传任意上游参数。
  body.store = false
  applyPromptCacheKey(body, promptCacheKey)
  if (isPlainObject(model.hardParams)) mergeDeep(body, model.hardParams)
  return body
}

/** 构建 /images/generations 请求体：纯文字生成新图。 */
export function buildImageBody(
  model: RequestModelConfig,
  prompt: string,
  userParams?: ModelParams | null,
): Record<string, unknown> {
  return buildImageRequestBody(model, prompt, userParams, false)
}

/**
 * 构建 /images/edits 请求体：编辑已有图片与「参考图生成」在上游是同一个端点，
 * images[0] 是主图（遮罩 / 标注只作用于它），其余作为参考，差别只在提示词怎么写。
 */
export function buildImageEditBody(
  model: RequestModelConfig,
  prompt: string,
  imageUrls: string[],
  userParams?: ModelParams | null,
): Record<string, unknown> {
  return {
    ...buildImageRequestBody(model, prompt, userParams, true),
    images: imageUrls.map((imageUrl) => ({ image_url: imageUrl })),
  }
}

function buildImageRequestBody(
  model: RequestModelConfig,
  prompt: string,
  userParams: ModelParams | null | undefined,
  editing: boolean,
): Record<string, unknown> {
  const options = resolveImageOptions(
    imageModelProfile(model.modelId),
    model.defaultParams?.image,
    userParams?.image,
    { editing },
  )
  // 生效值全部显式写出，请求预览与审计能看到本次实际参数，不依赖上游默认值的变化。
  const body: Record<string, unknown> = {
    model: model.modelId,
    prompt,
    n: options.n,
    size: options.size,
    quality: options.quality,
    output_format: options.output_format,
    background: options.background,
    moderation: options.moderation,
  }
  if (options.output_compression !== null) body.output_compression = options.output_compression
  if (options.complexity) body.complexity = options.complexity
  if (options.frame_count !== null) body.frame_count = options.frame_count
  if (options.frame_duration_ms !== null) body.frame_duration_ms = options.frame_duration_ms
  if (options.partial_images > 0) {
    body.stream = true
    body.partial_images = options.partial_images
  }
  if (isPlainObject(model.hardParams)) mergeDeep(body, model.hardParams)
  return body
}
