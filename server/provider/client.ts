import { joinBaseUrl } from '@shared/util/url'
import type { providers } from '../db/schema'
import { type ChatChunk, parseChatStream } from './chat'
import { UpstreamError, networkError, toUpstreamError } from './errors'
import { parseSSEStream, type StreamEvent } from './sse-parse'
import type { UpstreamResponse } from './upstream-types'

export interface UpstreamModel {
  id: string
  created?: number
  owned_by?: string
}

/**
 * 集中封装的上游客户端：所有对 OpenAI 兼容 Provider 的请求都经此类，
 * 不在各处散落 fetch。Base URL 通过 joinBaseUrl 拼接（base 末尾已是 /v1）。
 */
export class ProviderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private endpoint(path: string): string {
    return joinBaseUrl(this.baseUrl, path)
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra }
  }

  /** GET /models —— 拉取上游可用模型列表。 */
  async listModels(): Promise<UpstreamModel[]> {
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

  /** 通用 JSON POST（流式/非流式由后续阶段在此基础上扩展）。 */
  async postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    try {
      return await fetch(this.endpoint(path), {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal,
      })
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
  ): AsyncGenerator<ChatChunk> {
    const res = await this.postJson('/chat/completions', { ...body, stream: true }, signal)
    if (!res.ok) throw await toUpstreamError(res)
    if (!res.body) throw new UpstreamError({ message: '上游未返回流式响应', status: res.status })
    yield* parseChatStream(res.body)
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
export function providerClientFromRow(row: typeof providers.$inferSelect): ProviderClient {
  return new ProviderClient(row.baseUrl, row.apiKey)
}
