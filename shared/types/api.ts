import type {
  ContentPart,
  MessageStatus,
  MessageUsage,
  ModelCapabilities,
  ModelHardParams,
  ModelKind,
  ModelParams,
  ReasoningEffort,
  Role,
  UrlCitation,
  UserRole,
} from './domain'

/** 返回前端的用户信息（绝不含 passwordHash） */
export interface PublicUser {
  id: string
  username: string
  role: UserRole
  displayName: string | null
}

export interface AuthResponse {
  user: PublicUser
}

export interface BootstrapStatus {
  /** 系统中尚无任何用户：首位注册者免邀请码并成为管理员 */
  needsBootstrap: boolean
}

/** 统一错误响应结构 */
export interface ApiError {
  error: {
    message: string
    code?: string
    detail?: unknown
  }
}

// ===================== Provider / 模型 =====================

export interface ProviderDTO {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  hasApiKey: boolean
  apiKeyMask: string | null
  modelCount: number
  createdAt: number
}

/** 用户可见的模型信息（不含系统提示词、硬参数、密钥） */
export interface ModelDTO {
  id: string
  modelId: string
  displayName: string
  kind: ModelKind
  capabilities: ModelCapabilities
  allowedEfforts: ReasoningEffort[]
  defaultEffort: ReasoningEffort | null
  defaultWebSearch: boolean
  defaultParams: ModelParams | null
}

/** 管理员可见的完整模型配置 */
export interface AdminModelDTO extends ModelDTO {
  providerId: string
  providerName: string
  enabled: boolean
  defaultSystemPrompt: string | null
  hardParams: ModelHardParams | null
  sort: number
}

export interface SyncModelsResult {
  added: number
  total: number
  models: { modelId: string; isNew: boolean }[]
}

export interface ProviderTestResult {
  ok: boolean
  modelCount: number
}

// ===================== 会话 / 消息 =====================

export interface MessageDTO {
  id: string
  conversationId: string
  parentId: string | null
  role: Role
  status: MessageStatus
  content: ContentPart[]
  modelId: string | null
  runId: string | null
  reasoningSummary: string | null
  /** 从上游开始响应到第一段正文输出的耗时；无可靠事件时为 null。 */
  reasoningDurationMs: number | null
  annotations: UrlCitation[] | null
  usage: MessageUsage | null
  errorMessage: string | null
  createdAt: number
}

export interface ConversationDTO {
  id: string
  title: string | null
  modelId: string | null
  activeLeafId: string | null
  createdAt: number
  updatedAt: number
}

export interface ConversationDetail {
  conversation: ConversationDTO
  /** 会话内所有消息（分支树）；前端从 activeLeafId 向上构建可见路径 */
  messages: MessageDTO[]
}

export interface SendResult {
  conversation: ConversationDTO
  userMessage: MessageDTO
  assistantMessage: MessageDTO
}

export interface AttachmentDTO {
  id: string
  kind: 'image' | 'file'
  mime: string
  filename: string
  byteSize: number
}

// ===================== 管理后台 =====================

export interface InviteCodeDTO {
  id: string
  code: string
  note: string | null
  maxUses: number
  usedCount: number
  disabled: boolean
  expiresAt: number | null
  createdAt: number
}

export interface AdminUserDTO {
  id: string
  username: string
  role: UserRole
  displayName: string | null
  disabled: boolean
  createdAt: number
  lastActiveAt: number | null
  conversationCount: number
}

export interface StatsDTO {
  totals: { users: number; conversations: number; messages: number; runs: number; errors: number }
  tokens: { input: number; cached: number; output: number; reasoning: number; image: number; total: number }
  byModel: { model: string; calls: number; totalTokens: number }[]
  byUser: { username: string; calls: number; totalTokens: number }[]
}

export interface ErrorLogDTO {
  id: string
  scope: string
  errorType: string | null
  code: string | null
  httpStatus: number | null
  message: string
  createdAt: number
}

export interface UsageLogDTO {
  id: string
  modelLabel: string | null
  providerLabel: string | null
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  success: boolean
  errorType: string | null
  createdAt: number
}
