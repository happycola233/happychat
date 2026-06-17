// 上游 OpenAI Responses API 响应/事件的最小类型（仅声明我们会读取的字段）。

export interface UpstreamUsage {
  input_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
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
  type: string
  role?: string
  content?: UpstreamContentPart[]
  summary?: UpstreamSummaryPart[]
  /** image_generation_call 结果（base64） */
  result?: string | null
  status?: string
}

export interface UpstreamResponse {
  id?: string
  status?: string
  output?: UpstreamOutputItem[]
  usage?: UpstreamUsage
  incomplete_details?: { reason?: string } | null
  error?: { message?: string; code?: string } | null
}
