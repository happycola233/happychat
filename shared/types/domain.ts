// 集中管理的领域类型，前后端共享。JSON 字段类型也在此定义，供 Drizzle schema 复用。

export type UserRole = 'admin' | 'user'
export type Role = 'user' | 'assistant' | 'system'

/** 模型能力标记（管理员配置；前端据此显示/禁用对应控件） */
export interface ModelCapabilities {
  vision: boolean
  file_input: boolean
  web_search: boolean
  image_generation: boolean
  reasoning: boolean
}

/** OpenAI reasoning.effort，按模型门控（5.x 不支持 minimal） */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

/** 图片生成基础选项 */
export interface ImageOptions {
  size?: string
  quality?: string
  background?: string
}

/** 用户可调 + 模型默认参数 */
export interface ModelParams {
  temperature?: number
  top_p?: number
  verbosity?: 'low' | 'medium' | 'high'
  max_output_tokens?: number
  reasoning_effort?: ReasoningEffort
  web_search?: boolean
  image?: ImageOptions
}

/** 管理员硬参数：强制合并进上游请求，不暴露给普通用户（如 reasoning.summary='auto'、store=false、include） */
export type ModelHardParams = Record<string, unknown>

export type ModelKind = 'responses' | 'image'

/** web_search 引用注释（Responses API 扁平结构） */
export interface UrlCitation {
  type: 'url_citation'
  url: string
  title: string
  start_index: number
  end_index: number
}

/** 消息内容部件，存于 messages.content。图片/文件用 attachment_id 引用，不内联 base64。 */
export type ContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string; annotations?: UrlCitation[] }
  | { type: 'input_image'; attachment_id: string; detail?: 'auto' | 'low' | 'high' }
  | { type: 'input_file'; attachment_id: string; filename: string }
  | { type: 'image_result'; attachment_id: string; revised_prompt?: string }

export interface MessageUsage {
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}

export type MessageStatus = 'complete' | 'streaming' | 'interrupted' | 'error'

export type RunState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'canceled'
  | 'interrupted'

/** 用户界面偏好（持久化到 user_settings + localStorage） */
export interface UiPrefs {
  webSearch?: boolean
  reasoningEffort?: ReasoningEffort
  imageOptions?: { size?: string; quality?: string; background?: string }
}
