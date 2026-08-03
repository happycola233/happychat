import { isPlainObject } from './params'
import type { StreamEvent } from './sse-parse'
import type { AnthropicContentBlock, AnthropicUsage } from './anthropic'
import { friendlyUpstreamMessage, UpstreamError } from './errors'

export type AnthropicStreamEffect =
  | { type: 'text'; index: number; delta: string }
  | { type: 'thinking'; index: number; delta: string }
  | { type: 'citation'; index: number; citation: unknown; start: number; end: number }
  | { type: 'web_search_start'; index: number; id: string }
  | { type: 'web_search_input'; index: number; id: string; input: Record<string, unknown> }
  | {
      type: 'web_search_result'
      index: number
      toolUseId: string
      errorCode?: string
    }

interface BlockState {
  block: AnthropicContentBlock
  partialJson: string
  textStart: number
  stopped: boolean
}

function eventIndex(data: Record<string, unknown>): number {
  if (typeof data.index !== 'number') throw new Error('Anthropic content block 事件缺少 index')
  return data.index
}

function objectField(data: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = data[field]
  if (!isPlainObject(value)) throw new Error(`Anthropic 事件缺少 ${field}`)
  return value
}

/** Anthropic 流内 error 没有 HTTP 终态，按官方 error.type 还原等价状态码。 */
function anthropicStreamErrorStatus(type: string): number {
  switch (type) {
    case 'invalid_request_error':
      return 400
    case 'authentication_error':
      return 401
    case 'billing_error':
      return 402
    case 'permission_error':
      return 403
    case 'not_found_error':
      return 404
    case 'conflict_error':
      return 409
    case 'request_too_large':
      return 413
    case 'rate_limit_error':
      return 429
    case 'api_error':
      return 500
    case 'timeout_error':
      return 504
    case 'overloaded_error':
      return 529
    default:
      return 500
  }
}

/**
 * 单个 Messages HTTP 流的确定性聚合器。它按官方 index 保存 block 边界，同时只把可展示的
 * 文本、推理摘要、引用和搜索状态作为 effect 交给浏览器事件层。
 */
export class AnthropicStreamAccumulator {
  private readonly blocks = new Map<number, BlockState>()
  private textLength = 0
  private sawMessageStop = false

  messageId: string | null = null
  stopReason: string | null = null
  usage: AnthropicUsage = {}

  accept(event: StreamEvent): AnthropicStreamEffect[] {
    const effects: AnthropicStreamEffect[] = []
    switch (event.type) {
      case 'message_start': {
        const message = objectField(event.data, 'message')
        if (typeof message.id === 'string') this.messageId = message.id
        if (isPlainObject(message.usage)) this.mergeUsage(message.usage)
        break
      }
      case 'content_block_start': {
        const index = eventIndex(event.data)
        const contentBlock = objectField(event.data, 'content_block')
        const block = structuredClone(contentBlock)
        this.blocks.set(index, {
          block,
          partialJson: '',
          textStart: this.textLength,
          stopped: false,
        })
        if (
          block.type === 'server_tool_use' &&
          block.name === 'web_search' &&
          typeof block.id === 'string'
        ) {
          effects.push({ type: 'web_search_start', index, id: block.id })
        } else if (
          block.type === 'web_search_tool_result' &&
          typeof block.tool_use_id === 'string'
        ) {
          const resultError = isPlainObject(block.content) ? block.content : null
          effects.push({
            type: 'web_search_result',
            index,
            toolUseId: block.tool_use_id,
            ...(typeof resultError?.error_code === 'string'
              ? { errorCode: resultError.error_code }
              : {}),
          })
        }
        break
      }
      case 'content_block_delta': {
        const index = eventIndex(event.data)
        const state = this.blocks.get(index)
        if (!state) throw new Error(`Anthropic content_block_delta 引用了未知 index ${index}`)
        const delta = objectField(event.data, 'delta')
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          state.block.text = `${typeof state.block.text === 'string' ? state.block.text : ''}${delta.text}`
          this.textLength += delta.text.length
          effects.push({ type: 'text', index, delta: delta.text })
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          state.block.thinking = `${typeof state.block.thinking === 'string' ? state.block.thinking : ''}${delta.thinking}`
          effects.push({ type: 'thinking', index, delta: delta.thinking })
        } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
          state.block.signature = delta.signature
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          state.partialJson += delta.partial_json
        } else if (delta.type === 'citations_delta' && 'citation' in delta) {
          const citations = Array.isArray(state.block.citations) ? state.block.citations : []
          citations.push(structuredClone(delta.citation))
          state.block.citations = citations
        }
        break
      }
      case 'content_block_stop': {
        const index = eventIndex(event.data)
        const state = this.blocks.get(index)
        if (!state) throw new Error(`Anthropic content_block_stop 引用了未知 index ${index}`)
        state.stopped = true
        if (state.partialJson) state.block.input = JSON.parse(state.partialJson)
        if (
          state.block.type === 'server_tool_use' &&
          state.block.name === 'web_search' &&
          typeof state.block.id === 'string' &&
          isPlainObject(state.block.input)
        ) {
          effects.push({
            type: 'web_search_input',
            index,
            id: state.block.id,
            input: state.block.input,
          })
        }
        if (state.block.type === 'text' && Array.isArray(state.block.citations)) {
          const end =
            state.textStart + (typeof state.block.text === 'string' ? state.block.text.length : 0)
          for (const citation of state.block.citations) {
            effects.push({
              type: 'citation',
              index,
              citation,
              start: state.textStart,
              end,
            })
          }
        }
        break
      }
      case 'message_delta': {
        const delta = objectField(event.data, 'delta')
        if (typeof delta.stop_reason === 'string') this.stopReason = delta.stop_reason
        if (isPlainObject(event.data.usage)) this.mergeUsage(event.data.usage)
        break
      }
      case 'message_stop':
        this.sawMessageStop = true
        break
      case 'error': {
        const error = objectField(event.data, 'error')
        const type = typeof error.type === 'string' ? error.type : 'stream_error'
        const rawMessage =
          typeof error.message === 'string' ? error.message : 'Anthropic 流式响应失败'
        const status = anthropicStreamErrorStatus(type)
        throw new UpstreamError({
          message: friendlyUpstreamMessage(type, rawMessage, status),
          status,
          type,
          rawMessage,
        })
      }
      // ping 与未来新增事件不影响当前聚合；未知 content block 本体仍已完整保存在 start 数据中。
      default:
        break
    }
    return effects
  }

  finish(): AnthropicContentBlock[] {
    const hasOpenBlock = [...this.blocks.values()].some((state) => !state.stopped)
    if (hasOpenBlock) throw new Error('Anthropic 流在 content_block_stop 前结束')
    // 部分兼容网关会在完整 message_delta 后直接关闭 SSE，不发送规范中的 message_stop。
    // 只有 stop_reason 与全部 block 终止标记同时齐全时才接受，避免把真实截断误判为成功。
    if (!this.sawMessageStop && !this.stopReason) {
      throw new Error('Anthropic 流在 message_stop 前结束')
    }
    return [...this.blocks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, state]) => state.block)
  }

  private mergeUsage(usage: Record<string, unknown>): void {
    const mergedOutputDetails = {
      ...(this.usage.output_tokens_details ?? {}),
      ...(isPlainObject(usage.output_tokens_details) ? usage.output_tokens_details : {}),
    }
    this.usage = {
      ...this.usage,
      ...usage,
      ...(Object.keys(mergedOutputDetails).length
        ? { output_tokens_details: mergedOutputDetails }
        : {}),
    } as AnthropicUsage
  }
}
