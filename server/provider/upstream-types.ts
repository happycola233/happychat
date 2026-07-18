// 上游 OpenAI Responses API 响应/事件的最小类型（仅声明我们会读取的字段）。

export interface UpstreamUsage {
  input_tokens?: number
  input_tokens_details?: {
    /** 从提示词缓存读取的 token（OpenAI Responses API 标准字段）。 */
    cached_tokens?: number
    /** 写入提示词缓存的 token（OpenAI Responses API 标准字段）。 */
    cache_write_tokens?: number
  }
  output_tokens?: number
  output_tokens_details?: { reasoning_tokens?: number }
  total_tokens?: number
}

export interface UpstreamAnnotation {
  type: string
  url?: string
  title?: string
  start_index?: number
  end_index?: number
}

export interface UpstreamContentPart {
  type: string
  text?: string
  annotations?: UpstreamAnnotation[]
}

export interface UpstreamSummaryPart {
  type: string
  text?: string
}

export interface UpstreamOutputItem {
  id?: string
  type: string
  role?: string
  content?: UpstreamContentPart[]
  summary?: UpstreamSummaryPart[]
  /** reasoning item 的不透明加密上下文；仅服务端持久化与下一轮重放使用。 */
  encrypted_content?: string | null
  /** image_generation_call 结果（base64） */
  result?: string | null
  revised_prompt?: string | null
  status?: string
}

export interface UpstreamResponse {
  id?: string
  status?: string
  output?: UpstreamOutputItem[]
  /** 上游实际采用的推理上下文模式，仅记录回显值，不主动发送。 */
  reasoning?: { context?: string } | null
  usage?: UpstreamUsage
  incomplete_details?: { reason?: string } | null
  error?: { message?: string; code?: string } | null
}
