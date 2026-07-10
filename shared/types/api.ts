import type {
  AnnouncementAudience,
  AnnouncementChannel,
  AnnouncementLevel,
  AnnouncementPhase,
  AnnouncementStatus,
  ContentPart,
  MessageStatus,
  MessageUsage,
  ModelCapabilities,
  ModelHardParams,
  ModelKind,
  ModelParams,
  ModelPricing,
  PromptCacheRetention,
  ReasoningEffort,
  ReasoningEffortOption,
  Role,
  ThemePreference,
  UrlCitation,
  UserPreferences,
  UserRole,
} from './domain'

/** 返回前端的用户信息（绝不含 passwordHash） */
export interface PublicUser {
  id: string
  username: string
  role: UserRole
  displayName: string | null
  /** 头像 URL（未设置时为 null，前端回退首字母占位） */
  avatarUrl: string | null
}

export interface AuthResponse {
  user: PublicUser
}

/** 当前用户的设置（主题 + 账户级偏好） */
export interface UserSettingsDTO {
  theme: ThemePreference
  preferences: UserPreferences
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
  /** null=不指定保留策略，交给该上游决定。 */
  promptCacheRetention: PromptCacheRetention | null
  enabled: boolean
  hasApiKey: boolean
  apiKeyMask: string | null
  modelCount: number
  createdAt: number
}

/** 管理员编辑 Provider 时按需读取的详情，包含完整 API Key。 */
export interface ProviderDetailDTO extends ProviderDTO {
  apiKey: string
}

/** 用户可见的模型信息（不含系统提示词、硬参数、密钥） */
export interface ModelDTO {
  id: string
  modelId: string
  displayName: string
  kind: ModelKind
  capabilities: ModelCapabilities
  allowedEfforts: ReasoningEffortOption[]
  defaultEffort: ReasoningEffort | null
  defaultWebSearch: boolean
  defaultParams: ModelParams | null
}

/** 管理员可见的完整模型配置 */
export interface AdminModelDTO extends ModelDTO {
  providerId: string
  providerName: string
  enabled: boolean
  /** 是否对该模型应用 Provider 的显式缓存保留策略。 */
  promptCacheRetentionEnabled: boolean
  defaultSystemPrompt: string | null
  hardParams: ModelHardParams | null
  pricing: ModelPricing | null
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
  /** 模型显示名快照；公开分享页无需登录也可显示模型名。旧分享可能没有该字段。 */
  modelLabel?: string | null
  runId: string | null
  reasoningSummary: string | null
  /** 从上游开始响应到第一段正文输出的耗时；无可靠事件时为 null。 */
  reasoningDurationMs: number | null
  /** 整次生成的墙钟耗时（run.startedAt→finishedAt）；用于 TPS/耗时展示，无 run 时为 null。 */
  generationDurationMs: number | null
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
  pinnedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ConversationSearchResultDTO {
  conversation: ConversationDTO
  messageId: string | null
  matchType: 'title' | 'message'
  role: Role | null
  snippet: string
}

export interface ConversationDetail {
  conversation: ConversationDTO
  /** 会话内所有消息（分支树）；前端从 activeLeafId 向上构建可见路径 */
  messages: MessageDTO[]
  /** 该会话最近一次生成所用模型（DB id），用于打开会话时恢复模型选择 */
  lastModelId: string | null
  /** 该会话最近一次生成的联网/思考设置，用于恢复控件 */
  lastParams: { web_search?: boolean; reasoning_effort?: ReasoningEffort } | null
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
  /** 是否允许分享：null=随全局，true/false=按用户覆盖 */
  canShare: boolean | null
  createdAt: number
  lastActiveAt: number | null
  conversationCount: number
}

export interface StatsDTO {
  totals: { users: number; conversations: number; messages: number; runs: number; errors: number }
  tokens: {
    input: number
    cacheWrite: number
    cached: number
    output: number
    reasoning: number
    image: number
    total: number
  }
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
  detail: Record<string, unknown> | null
  userId: string | null
  username: string | null
  runId: string | null
  createdAt: number
}

export interface UsageLogDTO {
  id: string
  userId: string | null
  username: string | null
  providerId: string | null
  providerLabel: string | null
  modelLabel: string | null
  inputTokens: number
  cacheWriteTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  imageTokens: number
  success: boolean
  errorType: string | null
  costUsd: number
  /** 从生成引擎开始到 run 终态的墙钟耗时；关联 run 不存在时为 null。 */
  durationMs: number | null
  createdAt: number
}

// ===================== 统计 / 分析（细分后台）=====================

/** 通用分页结果。 */
export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** 概览页：核心指标 + 请求健康时间线。 */
export interface OverviewDTO {
  totals: {
    requests: number
    successRate: number // 0-1
    tokens: number
    cacheRate: number // cached / input，0-1
    rpm: number // 最近 60 分钟请求/分
    tpm: number // 最近 60 分钟 token/分
    costUsd: number
    users: number
    conversations: number
    messages: number
    errors: number
  }
  /** 按时间桶的请求量与错误量，用于健康时间线。 */
  healthTimeline: { ts: number; requests: number; errors: number }[]
}

/** 分析页时间序列的一个数据点。 */
export interface AnalyticsSeriesPoint {
  ts: number
  requests: number
  inputTokens: number
  cacheWriteTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
}

export interface AnalyticsDTO {
  bucket: 'hour' | 'day'
  series: AnalyticsSeriesPoint[]
}

/** 分用户统计（分析页用户表 / 用户详情头部）。 */
export interface UserStatDTO {
  userId: string
  username: string
  displayName: string | null
  requests: number
  conversations: number
  messages: number
  totalTokens: number
  reasoningTokens: number
  imageGenerations: number
  fileUploads: number
  costUsd: number
  errors: number
  successRate: number // 0-1
  lastActive: number | null
  topModels: { model: string; calls: number }[]
}

/** 管理端登录会话。 */
export interface AdminSessionDTO {
  id: string
  userId: string
  username: string
  userAgent: string | null
  createdAt: number
  expiresAt: number
}

// ===================== 全局设置 / 分享 =====================

/** 全局应用设置（管理员可改）。 */
export interface AppConfigDTO {
  sharingEnabled: boolean
  titleEnabled: boolean
  titleModelId: string | null
  titlePrompt: string | null
}

// ===================== 站内公告 =====================

/** 管理端可见的完整公告记录（含派生运行态与已读统计）。 */
export interface AdminAnnouncementDTO {
  id: string
  title: string
  body: string
  level: AnnouncementLevel
  channel: AnnouncementChannel
  audience: AnnouncementAudience
  status: AnnouncementStatus
  pinned: boolean
  /** 强提示弹窗对每个用户最多自动弹出的次数 */
  maxImpressions: number
  publishAt: number | null
  expiresAt: number | null
  createdByName: string | null
  createdAt: number
  updatedAt: number
  /** status + 生效窗口派生的运行态 */
  phase: AnnouncementPhase
  /** 已读人数 */
  readCount: number
  /** 目标受众总人数（用于「已读 X/Y 人」） */
  audienceCount: number
}

/** 管理端「谁已读」名单中的一项。 */
export interface AnnouncementReaderDTO {
  userId: string
  username: string
  displayName: string | null
  readAt: number
}

/** 用户端可见的一条生效公告（含当前用户是否已读）。 */
export interface UserAnnouncementDTO {
  id: string
  title: string
  body: string
  level: AnnouncementLevel
  channel: AnnouncementChannel
  pinned: boolean
  publishAt: number | null
  createdAt: number
  /** 当前用户是否已读（已确认） */
  read: boolean
  /** 强提示弹窗的最大自动弹出次数 */
  maxImpressions: number
  /** 强提示弹窗对该用户已自动弹出的次数 */
  impressions: number
}

/** 用户自己/管理员看到的一条分享记录。 */
export interface SharedChatDTO {
  id: string
  token: string
  conversationId: string
  title: string | null
  showAvatar: boolean
  showName: boolean
  expiresAt: number | null
  revoked: boolean
  createdAt: number
  /** 管理端列表附带的拥有者用户名 */
  ownerUsername?: string
}

/** 公开分享视图（无需登录）。 */
export interface PublicShareDTO {
  title: string | null
  messages: MessageDTO[]
  createdAt: number
  owner: { name: string | null; avatarUrl: string | null }
}
