import type { ProviderProtocol } from '@shared/types/domain'
import type { AnthropicCatalogCapabilities } from '@shared/util/anthropic'
import { joinAnthropicUrl, joinBaseUrl } from '@shared/util/url'
import type { providers } from '../db/schema'
import { type ChatStreamEvent, parseChatStream } from './chat'
import { UpstreamError, networkError, toUpstreamError } from './errors'
import type { UpstreamResponseTimingObserver } from './response-timing'
import { parseSSEStream, type StreamEvent } from './sse-parse'
import type { UpstreamResponse } from './upstream-types'

export interface UpstreamModel {
  id: string
  created?: number
  owned_by?: string
  display_name?: string
  created_at?: string
  capabilities?: AnthropicCatalogCapabilities
  max_input_tokens?: number
  max_tokens?: number
}

const ANTHROPIC_MAX_REQUEST_BYTES = 32 * 1024 * 1024

/**
 * 集中封装的上游客户端：OpenAI 兼容与 Anthropic Provider 的请求都经此类，
 * 不在各处散落 fetch。两种协议分别通过对应 URL helper 兼容根地址和已含版本路径的网关。
 */
export class ProviderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly protocol: ProviderProtocol = 'openai',
    private readonly responseTimingObserver?: UpstreamResponseTimingObserver,
  ) {}

  private endpoint(path: string): string {
    return joinBaseUrl(this.baseUrl, path)
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra }
  }

  private anthropicHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      ...extra,
    }
  }

  /** GET /models —— 拉取上游可用模型列表。 */
  async listModels(): Promise<UpstreamModel[]> {
    if (this.protocol === 'anthropic') return this.listAnthropicModels()
    let res: Response
    try {
      res = await fetch(this.endpoint('/models'), { headers: this.authHeaders() })
    } catch (e) {
      throw networkError(e)
    }
    if (!res.ok) throw await toUpstreamError(res)
    const data = (await res.json()) as { data?: UpstreamModel[] }
    return data.data ?? []
  }

  private async listAnthropicModels(): Promise<UpstreamModel[]> {
    const models: UpstreamModel[] = []
    let afterId: string | null = null
    for (;;) {
      const url = new URL(joinAnthropicUrl(this.baseUrl, '/v1/models'))
      url.searchParams.set('limit', '100')
      if (afterId) url.searchParams.set('after_id', afterId)

      let res: Response
      try {
        res = await fetch(url, { headers: this.anthropicHeaders() })
      } catch (e) {
        throw networkError(e)
      }
      if (!res.ok) throw await toUpstreamError(res)
      const page = (await res.json()) as {
        data?: UpstreamModel[]
        has_more?: boolean
        last_id?: string | null
      }
      models.push(...(page.data ?? []))
      if (!page.has_more) return models
      if (!page.last_id) throw new Error('Anthropic Models 分页响应缺少 last_id')
      afterId = page.last_id
    }
  }

  /** 通用 JSON POST（流式/非流式由后续阶段在此基础上扩展）。 */
  async postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const serializedBody = JSON.stringify(body)
    const requestStartedAtMs = Date.now()
    this.responseTimingObserver?.onRequestStart(requestStartedAtMs)
    try {
      const response = await fetch(this.endpoint(path), {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: serializedBody,
        signal,
      })
      this.responseTimingObserver?.onResponseHeaders({
        requestStartedAtMs,
        responseHeadersAtMs: Date.now(),
        ok: response.ok,
      })
      return response
    } catch (e) {
      throw networkError(e)
    }
  }

  /** Anthropic 原生 JSON POST；与 OpenAI 兼容路径隔离鉴权头和版本路径。 */
  private async postAnthropicMessage(body: unknown, signal?: AbortSignal): Promise<Response> {
    const serializedBody = JSON.stringify(body)
    if (Buffer.byteLength(serializedBody, 'utf8') > ANTHROPIC_MAX_REQUEST_BYTES) {
      throw new UpstreamError({
        message: '请求体超过 Anthropic Messages 的 32MB 限制。',
        status: 413,
        type: 'request_too_large',
      })
    }
    const requestStartedAtMs = Date.now()
    this.responseTimingObserver?.onRequestStart(requestStartedAtMs)
    try {
      const response = await fetch(joinAnthropicUrl(this.baseUrl, '/v1/messages'), {
        method: 'POST',
        headers: this.anthropicHeaders({ 'Content-Type': 'application/json' }),
        body: serializedBody,
        signal,
      })
      this.responseTimingObserver?.onResponseHeaders({
        requestStartedAtMs,
        responseHeadersAtMs: Date.now(),
        ok: response.ok,
      })
      return response
    } catch (e) {
      throw networkError(e)
    }
  }

  /** POST /responses（非流式）：返回完整 Response 对象。 */
  async createResponse(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<UpstreamResponse> {
    const res = await this.postJson('/responses', body, signal)
    if (!res.ok) throw await toUpstreamError(res)
    return (await res.json()) as UpstreamResponse
  }

  /** POST /responses（流式）：返回去除 obfuscation 后的事件流。 */
  async *createResponseStream(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const res = await this.postJson('/responses', { ...body, stream: true }, signal)
    if (!res.ok) throw await toUpstreamError(res)
    if (!res.body) throw new UpstreamError({ message: '上游未返回流式响应', status: res.status })
    yield* parseSSEStream(res.body)
  }

  /** POST /chat/completions（非流式）：返回完整 JSON（用于标题总结等）。 */
  async createChat(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const res = await this.postJson('/chat/completions', body, signal)
    if (!res.ok) throw await toUpstreamError(res)
    return res.json()
  }

  /** POST /chat/completions（流式）：返回 ChatChunk 序列。 */
  async *createChatStream(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const res = await this.postJson('/chat/completions', { ...body, stream: true }, signal)
    if (!res.ok) throw await toUpstreamError(res)
    if (!res.body) throw new UpstreamError({ message: '上游未返回流式响应', status: res.status })
    yield* parseChatStream(res.body)
  }

  /** POST /v1/messages（非流式）：用于标题生成等短任务。 */
  async createAnthropicMessage(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const res = await this.postAnthropicMessage({ ...body, stream: false }, signal)
    if (!res.ok) throw await toUpstreamError(res)
    return res.json()
  }

  /** POST /v1/messages（流式）：返回 Anthropic 原生 SSE 事件。 */
  async *createAnthropicMessageStream(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const res = await this.postAnthropicMessage({ ...body, stream: true }, signal)
    if (!res.ok) throw await toUpstreamError(res)
    if (!res.body) throw new UpstreamError({ message: '上游未返回流式响应', status: res.status })
    yield* parseSSEStream(res.body)
  }

  /** POST /images/generations（非流式）：返回原始 JSON（含 data[].b64_json）。 */
  async createImage(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const res = await this.postJson('/images/generations', body, signal)
    if (!res.ok) throw await toUpstreamError(res)
    return res.json()
  }

  /** POST /images/edits（非流式）：用输入图 + prompt 生成编辑结果。 */
  async editImage(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const res = await this.postJson('/images/edits', body, signal)
    if (!res.ok) throw await toUpstreamError(res)
    return res.json()
  }
}

/** 由 providers 表行构造客户端。 */
export function providerClientFromRow(
  row: typeof providers.$inferSelect,
  responseTimingObserver?: UpstreamResponseTimingObserver,
): ProviderClient {
  return new ProviderClient(row.baseUrl, row.apiKey, row.protocol, responseTimingObserver)
}
