import { REASONING_MIN_OUTPUT_TOKENS } from '@shared/constants'
import type { MessageUsage, ModelParams, PromptCacheRetention } from '@shared/types/domain'
import { effectiveReasoningEffort } from '@shared/util/reasoning'
import type { models } from '../db/schema'
import type { PathMessage, ResolvedAttachment } from './context'
import { isPlainObject, mergeDeep } from './params'
import { applyPromptCacheParameters } from './promptCache'

type ModelRow = typeof models.$inferSelect

export interface ChatDelta {
  role?: string
  content?: string
  reasoning_content?: string
}

export interface ChatChunk {
  choices?: { delta?: ChatDelta; finish_reason?: string | null }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
      cache_write_tokens?: number
    }
    completion_tokens_details?: { reasoning_tokens?: number }
  } | null
}

/** chat/completions 用量 → 统一 MessageUsage。 */
export function mapChatUsage(u: ChatChunk['usage']): MessageUsage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    cacheWriteTokens: u?.prompt_tokens_details?.cache_write_tokens ?? 0,
    cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: u?.total_tokens ?? 0,
  }
}

/**
 * 把分支路径消息转成 chat/completions 的 messages[]。
 * system 来自 instructions；用户图片用多模态 content；文件输入 chat 接口不支持，忽略。
 */
export function buildChatMessages(
  messages: PathMessage[],
  attachments: Map<string, ResolvedAttachment> | undefined,
  instructions: string | null,
): unknown[] {
  const atts = attachments ?? new Map<string, ResolvedAttachment>()
  const out: unknown[] = []
  if (instructions) out.push({ role: 'system', content: instructions })

  for (const m of messages) {
    if (m.role === 'user' && m.runtimeContext) {
      out.push({ role: 'system', content: m.runtimeContext })
    }

    if (m.role === 'assistant') {
      const text = m.content.map((p) => (p.type === 'output_text' ? p.text : '')).join('')
      out.push({ role: 'assistant', content: text })
      continue
    }
    if (m.role === 'system') {
      const text = m.content.map((p) => (p.type === 'input_text' ? p.text : '')).join('')
      if (text) out.push({ role: 'system', content: text })
      continue
    }
    let text = ''
    const imageParts: unknown[] = []
    for (const part of m.content) {
      if (part.type === 'input_text') text += part.text
      else if (part.type === 'input_image') {
        const a = atts.get(part.attachment_id)
        if (a) imageParts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
      }
      // input_file：chat/completions 无标准文件输入，忽略
    }
    if (imageParts.length > 0) {
      out.push({ role: 'user', content: [{ type: 'text', text }, ...imageParts] })
    } else {
      out.push({ role: 'user', content: text })
    }
  }
  return out
}

export interface BuildChatBodyOptions {
  model: ModelRow
  messages: unknown[]
  userParams?: ModelParams | null
  stream: boolean
  promptCacheKey?: string
  promptCacheRetention?: PromptCacheRetention | null
}

/** 构建 /chat/completions 请求体。参数优先级同 Responses：硬参数 > 用户 > 模型默认。 */
export function buildChatBody(o: BuildChatBodyOptions): Record<string, unknown> {
  const { model, messages, userParams, stream, promptCacheKey, promptCacheRetention } = o
  const defaults = model.defaultParams ?? {}
  const body: Record<string, unknown> = { model: model.modelId, messages, stream }

  const temperature = userParams?.temperature ?? defaults.temperature
  if (temperature !== undefined) body.temperature = temperature
  const topP = userParams?.top_p ?? defaults.top_p
  if (topP !== undefined) body.top_p = topP

  const effort = effectiveReasoningEffort(model, userParams)
  if (effort) {
    body.reasoning_effort = effort
  }

  let maxOut = userParams?.max_output_tokens ?? defaults.max_output_tokens
  if (effort && effort !== 'none') maxOut = Math.max(maxOut ?? 0, REASONING_MIN_OUTPUT_TOKENS)
  if (maxOut !== undefined && maxOut > 0) body.max_tokens = maxOut

  if (stream) body.stream_options = { include_usage: true }
  applyPromptCacheParameters(body, promptCacheKey, promptCacheRetention)
  // 与 Responses 一致：高级 JSON 最终优先，可覆盖应用生成的缓存参数。
  if (isPlainObject(model.hardParams)) mergeDeep(body, model.hardParams)
  return body
}

/** 解析 chat/completions 的 SSE 流为 ChatChunk 序列（每个 data: JSON）。 */
export async function* parseChatStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    buf = buf.replace(/\r\n/g, '\n')
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = parseChatBlock(buf.slice(0, idx))
      buf = buf.slice(idx + 2)
      if (chunk) yield chunk
    }
  }
  const tail = parseChatBlock(buf.replace(/\r\n/g, '\n'))
  if (tail) yield tail
}

function parseChatBlock(block: string): ChatChunk | null {
  let dataStr = ''
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('data:')) dataStr += line.slice(5).replace(/^ /, '')
  }
  if (!dataStr || dataStr === '[DONE]') return null
  try {
    return JSON.parse(dataStr) as ChatChunk
  } catch {
    return null
  }
}
