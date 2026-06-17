import { REASONING_MIN_OUTPUT_TOKENS } from '@shared/constants'
import type { ModelParams } from '@shared/types/domain'
import type { models } from '../db/schema'

type ModelRow = typeof models.$inferSelect

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function mergeDeep(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    const existing = target[k]
    if (isPlainObject(v) && isPlainObject(existing)) mergeDeep(existing, v)
    else target[k] = v
  }
}

export interface BuildBodyOptions {
  model: ModelRow
  input: unknown[]
  instructions: string | null
  userParams?: ModelParams | null
  stream: boolean
}

/**
 * 构建上游 /responses 请求体。
 * 参数优先级：管理员硬参数 > 用户请求参数 > 模型默认 > 代码默认。
 * 始终 store=false（本地重放，不发 previous_response_id）。
 */
export function buildResponseBody(o: BuildBodyOptions): Record<string, unknown> {
  const { model, input, instructions, userParams, stream } = o
  const defaults = model.defaultParams ?? {}
  const caps = model.capabilities
  const body: Record<string, unknown> = { model: model.modelId, input, stream }

  if (instructions) body.instructions = instructions

  const temperature = userParams?.temperature ?? defaults.temperature
  if (temperature !== undefined) body.temperature = temperature
  const topP = userParams?.top_p ?? defaults.top_p
  if (topP !== undefined) body.top_p = topP
  const verbosity = userParams?.verbosity ?? defaults.verbosity
  if (verbosity !== undefined) body.text = { verbosity }

  // 思考：按模型 allowedEfforts 校验；含 'none'（受硬参数 summary='auto' 控制摘要）
  const effort =
    userParams?.reasoning_effort ?? defaults.reasoning_effort ?? model.defaultEffort ?? undefined
  const allowed = model.allowedEfforts ?? []
  if (caps.reasoning && effort && allowed.includes(effort)) {
    body.reasoning = { effort }
  }

  // 联网搜索：仅当模型支持且开关开启
  const webSearch = userParams?.web_search ?? defaults.web_search ?? model.defaultWebSearch
  if (caps.web_search && webSearch) {
    body.tools = [{ type: 'web_search' }]
  }

  // max_output_tokens：开启思考时保证下限预算
  let maxOut = userParams?.max_output_tokens ?? defaults.max_output_tokens
  if (body.reasoning) maxOut = Math.max(maxOut ?? 0, REASONING_MIN_OUTPUT_TOKENS)
  if (maxOut !== undefined && maxOut > 0) body.max_output_tokens = maxOut

  // 管理员硬参数最后深合并（如 reasoning.summary='auto'）
  if (isPlainObject(model.hardParams)) mergeDeep(body, model.hardParams)

  body.store = false
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
