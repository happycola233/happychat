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

/** 按模型定价（USD / 每 100 万 token）；留空的项不计入成本估算。 */
export interface ModelPricing {
  input?: number
  cachedInput?: number
  output?: number
  image?: number
}

export type ModelKind = 'responses' | 'chat' | 'image'

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

/** 主题偏好（持久化到 user_settings.theme） */
export type ThemePreference = 'system' | 'light' | 'dark'

/** 消息正文字号档位 */
export type MessageFontSize = 'small' | 'medium' | 'large'

/** 消息时间显示格式：仅时间 / 日期+时间 */
export type MessageTimeFormat = 'time' | 'datetime'

/**
 * 账户级用户偏好：服务端为源（持久化到 user_settings.preferences），
 * 前端以 localStorage 作首屏缓存避免闪烁。注意区别于 store/chat.ts 里的
 * 编排器临时态（选中模型 / 联网 / 思考等级 / 图片选项）。
 */
export interface UserPreferences {
  // —— 聊天行为 ——
  /** 打开对话时自动滚动到最新消息 */
  autoScrollOnOpen: boolean
  /** 显示「滚动到底部」浮动按钮 */
  showScrollToBottom: boolean
  /** 按 Enter 发送（关闭则 Enter 换行、Ctrl/⌘+Enter 发送） */
  sendOnEnter: boolean
  /** 默认展开推理摘要（关闭则生成完成后自动折叠） */
  defaultExpandReasoning: boolean
  // —— 消息显示 ——
  /** 正文字号档位 */
  messageFontSize: MessageFontSize
  /** 在每条消息上显示时间 */
  showMessageTime: boolean
  /** 消息时间格式：仅时间 / 日期+时间 */
  messageTimeFormat: MessageTimeFormat
  /** 在助手消息上显示所用模型名 */
  showModelLabel: boolean
  /** 在助手消息下方显示 Token / TPS / 耗时 明细 */
  showUsageStats: boolean
}
