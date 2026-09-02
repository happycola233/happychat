import { REASONING_MIN_OUTPUT_TOKENS } from '@shared/constants'
import type { MessageUsage, ModelParams } from '@shared/types/domain'
import { effectiveReasoningEffort } from '@shared/util/reasoning'
import { commentaryTextsOf } from '@shared/util/processTrack'
import type { models } from '../db/schema'
import type { PathMessage, ResolvedAttachment } from './context'
import { friendlyUpstreamMessage, UpstreamError } from './errors'
import { isPlainObject, mergeDeep } from './params'
import { applyPromptCacheKey } from './promptCache'

type ModelRow = typeof models.$inferSelect

export interface ChatDelta {
  role?: string
  content?: string | null
  reasoning_content?: string | null
  refusal?: string | null
  tool_calls?: unknown[]
  function_call?: unknown
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

export type ChatStreamEvent = { type: 'chunk'; chunk: ChatChunk } | { type: 'done' }

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
 * system 来自 instructions；用户图片与文件使用 Chat Completions 多模态 content parts。
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
      const commentary = commentaryTextsOf(m).join('\n\n')
      const answer = m.content.map((p) => (p.type === 'output_text' ? p.text : '')).join('')
      const text = [commentary, answer].filter(Boolean).join('\n\n')
      out.push({ role: 'assistant', content: text })
      continue
    }
    if (m.role === 'system') {
      const text = m.content.map((p) => (p.type === 'input_text' ? p.text : '')).join('')
      if (text) out.push({ role: 'system', content: text })
      continue
    }
    let text = ''
    const attachmentParts: unknown[] = []
    for (const part of m.content) {
      if (part.type === 'input_text') text += part.text
      else if (part.type === 'input_image') {
        const a = atts.get(part.attachment_id)
        if (a) attachmentParts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
      } else if (part.type === 'input_file') {
        const a = atts.get(part.attachment_id)
        if (a) {
          attachmentParts.push({
            type: 'file',
            file: { filename: a.filename, file_data: a.dataUrl },
          })
        }
      }
    }
    if (attachmentParts.length > 0) {
      out.push({
        role: 'user',
        content: [...(text ? [{ type: 'text', text }] : []), ...attachmentParts],
      })
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
}

/** 构建 /chat/completions 请求体。参数优先级同 Responses：硬参数 > 用户 > 模型默认。 */
export function buildChatBody(o: BuildChatBodyOptions): Record<string, unknown> {
  const { model, messages, userParams, stream, promptCacheKey } = o
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
  if (maxOut !== undefined && maxOut > 0) body.max_completion_tokens = maxOut

  if (stream) body.stream_options = { include_usage: true }
  applyPromptCacheKey(body, promptCacheKey)
  // 与 Responses 一致：高级 JSON 最终优先，可覆盖 key 并透传任意上游参数。
  if (isPlainObject(model.hardParams)) {
    const hardParams = { ...model.hardParams }
    // 兼容升级前保存的 Chat 配置；绝不能同时发送新旧两个输出上限字段。
    if (hardParams.max_completion_tokens === undefined && hardParams.max_tokens !== undefined) {
      hardParams.max_completion_tokens = hardParams.max_tokens
    }
    delete hardParams.max_tokens
    mergeDeep(body, hardParams)
  }
  return body
}

/** 解析 chat/completions SSE，并保留 [DONE] 供引擎校验流是否正常结束。 */
export async function* parseChatStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      buf = buf.replace(/\r\n/g, '\n')
      let idx: number
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const event = parseChatBlock(buf.slice(0, idx))
        buf = buf.slice(idx + 2)
        if (event) yield event
      }
    }
    buf += decoder.decode()
    const tail = parseChatBlock(buf.replace(/\r\n/g, '\n'))
    if (tail) yield tail
  } catch (error) {
    // 畸形帧或 200 error frame 后不再消费响应体，主动取消以释放连接与缓冲。
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}

function parseChatBlock(block: string): ChatStreamEvent | null {
  const dataLines: string[] = []
  let eventName: string | null = null
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    else if (line.startsWith('event:')) eventName = line.slice(6).trim()
  }
  if (dataLines.length === 0) return null
  const dataStr = dataLines.join('\n')
  if (!dataStr) return null
  if (dataStr === '[DONE]') return { type: 'done' }

  let parsed: unknown
  try {
    parsed = JSON.parse(dataStr)
  } catch {
    throw new UpstreamError({
      message: '上游返回了无法解析的 chat/completions 流数据',
      status: 200,
      type: 'invalid_stream',
      code: 'malformed_sse_json',
    })
  }

  if (!isPlainObject(parsed)) {
    throw new UpstreamError({
      message: '上游返回了无效的 chat/completions 流数据',
      status: 200,
      type: 'invalid_stream',
      code: 'invalid_sse_payload',
    })
  }

  const isTopLevelError =
    eventName === 'error' || parsed.type === 'error' || parsed.object === 'error'
  if ((parsed.error !== undefined && parsed.error !== null) || isTopLevelError) {
    const error = isPlainObject(parsed.error) ? parsed.error : isTopLevelError ? parsed : null
    const rawMessage =
      typeof error?.message === 'string'
        ? error.message
        : typeof parsed.error === 'string'
          ? parsed.error
          : '上游流式响应失败'
    const errorType = typeof error?.type === 'string' ? error.type : undefined
    const errorCode =
      typeof error?.code === 'string' || typeof error?.code === 'number'
        ? String(error.code)
        : undefined
    throw new UpstreamError({
      message: friendlyUpstreamMessage(errorType, rawMessage, 200),
      status: 200,
      type: errorType,
      code: errorCode,
      rawMessage,
    })
  }

  return { type: 'chunk', chunk: parsed as ChatChunk }
}
