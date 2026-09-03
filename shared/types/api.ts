import type {
  AnnouncementAudience,
  AnnouncementChannel,
  AnnouncementLevel,
  AnnouncementPhase,
  AnnouncementStatus,
  ContentPart,
  CostCurrency,
  EffectiveQuotaRule,
  QuotaAdjustmentKind,
  QuotaLimit,
  QuotaMetric,
  QuotaRule,
  QuotaRuleSource,
  QuotaScope,
  QuotaWeekStart,
  QuotaWindow,
  UserQuotaOverrides,
  MessageStatus,
  MessageUsage,
  ModelCapabilities,
  ModelAccessMode,
  ModelHardParams,
  ModelGroupIcon,
  ModelIcon,
  ModelKind,
  ModelParams,
  ModelPricing,
  ModelTag,
  ProviderProtocol,
  ProcessStep,
  ReasoningEffort,
  ReasoningEffortOption,
  Role,
  ThemePreference,
  UrlCitation,
  UsageLogKind,
  UsageOutcome,
  UsageResult,
  UsageStatsView,
  UsageTrendGranularity,
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
  /** 管理员重置密码后为 true；完成强制改密前不得进入业务界面。 */
  mustChangePassword: boolean
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
  /** 全局注册策略；首位注册者不受此设置限制 */
  registrationRequiresInviteCode: boolean
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
  protocol: ProviderProtocol
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
  /** 用户可见的模型简介（模型选择器 ⓘ 展示）；null=未配置 */
  description: string | null
  /** 用户可见的模型标签；可自定义主题色，null 时按文字自动配色。 */
  tags: ModelTag[]
  /** 用户可见的模型图标；null=自动识别品牌，initial=显式使用名称首字母。 */
  icon: ModelIcon | null
  /** 所属分组 id；null=未分组。 */
  groupId: string | null
  allowedEfforts: ReasoningEffortOption[]
  defaultEffort: ReasoningEffort | null
  defaultWebSearch: boolean
  defaultXSearch: boolean
  defaultParams: ModelParams | null
}

/** 管理员可见的完整模型配置 */
export interface AdminModelDTO extends ModelDTO {
  providerId: string
  providerName: string
  enabled: boolean
  /** 用户端开放范围；与 enabled 全局总开关相互独立。 */
  accessMode: ModelAccessMode
  /** accessMode=selected 时当前名单人数；all 时固定为 0。 */
  allowedUserCount: number
  defaultSystemPrompt: string | null
  /** 是否让服务端持久化并重放提供商私有上下文。 */
  replayProviderContext: boolean
  hardParams: ModelHardParams | null
  pricing: ModelPricing | null
  sort: number
}

/** 管理员读取/替换单个模型的用户访问范围。 */
export interface ModelAccessDTO {
  accessMode: ModelAccessMode
  /** selected 模式下的完整用户 ID 名单；all 模式下为空数组。 */
  userIds: string[]
}

/**
 * 模型分组（管理员定义的全站结构）。用户端据此渲染模型选择器的
 * 「平铺分组标题」与「二级目录」两种视图；不含任何管理员专属字段。
 */
export interface ModelGroupDTO {
  id: string
  name: string
  /** 分组图标；null=默认文件夹图形，none=完全不显示图标 */
  icon: ModelGroupIcon | null
  /** 默认文件夹图形颜色（#RRGGBB）；显式图标或无图标模式下为 null */
  color: string | null
  sort: number
}

/** 管理端分组列表：额外带组内模型数（含未上架/受限模型）与时间戳。 */
export interface AdminModelGroupDTO extends ModelGroupDTO {
  modelCount: number
  createdAt: number
  updatedAt: number
}

/** 管理员上传的自定义图标库条目。 */
export interface CustomIconDTO {
  id: string
  name: string
  createdAt: number
}

/** 内置图标目录条目；mono=SVG 内部使用 currentColor，可随主题变色（前端用 CSS mask 渲染）。 */
export interface LobeIconEntry {
  slug: string
  mono: boolean
}

export interface LobeIconCatalogDTO {
  version: string
  icons: LobeIconEntry[]
}

export interface SyncModelsResult {
  added: number
  total: number
  models: { modelId: string; isNew: boolean }[]
}

/** 供应商上游模型目录中的一项（管理端「挑选模型」用）。 */
export interface UpstreamCatalogModelDTO {
  modelId: string
  /** 该上游模型 id 在本站已存在的实例数（>0 时界面显示「已添加」）。 */
  existingCount: number
}

export interface ImportModelsResult {
  added: number
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
  /** 思考、进展说明与检索动作按真实发生顺序组成的过程轨。 */
  processSteps: ProcessStep[]
  /** 从上游开始响应到第一段正文输出的耗时；无可靠事件或快照时为 null。 */
  reasoningDurationMs: number | null
  /** 整次生成的墙钟耗时；优先由 run 起止时间计算，无 run 时可使用消息快照。 */
  generationDurationMs: number | null
  annotations: UrlCitation[] | null
  usage: MessageUsage | null
  /** 请求时价格快照计算的预估成本（USD）；旧消息/分享快照可能没有该字段。 */
  costUsd?: number | null
  errorMessage: string | null
  createdAt: number
}

export interface ConversationDTO {
  id: string
  title: string | null
  modelId: string | null
  /** 所属文件夹 id；null=未分组 */
  folderId: string | null
  activeLeafId: string | null
  pinnedAt: number | null
  createdAt: number
  updatedAt: number
}

/** 聊天文件夹（侧边栏分组）：支持自定义主题色、Emoji 图标与置顶。 */
export interface FolderDTO {
  id: string
  name: string
  /** 主题色（#RRGGBB）；旧数据中的 null 按默认黄色显示 */
  color: string | null
  /** 图标 Emoji；null=默认文件夹图标 */
  emoji: string | null
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
  /** 该会话最近一次生成的联网/X 搜索/思考设置；推理强度缺省表示自动 */
  lastParams: {
    web_search?: boolean
    x_search?: boolean
    reasoning_effort?: ReasoningEffort
  } | null
  /** 消息用量行的成本展示口径；人民币汇率仅随响应返回，不持久化。 */
  messageCostDisplay: MessageCostDisplayDTO
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

/** 导出预览（导出弹窗实时展示产物结构与主文件文本片段）。 */
export interface ExportPreviewDTO {
  /** 最终下载文件名（含扩展名；打包时为 .zip） */
  filename: string
  /** file=单文件；zip=ZIP 包（主文件 + assets/ 附件） */
  kind: 'file' | 'zip'
  mime: string
  /** 主文本文件内容（超长时截断） */
  preview: string
  truncated: boolean
  /** kind=zip 时的条目名与字节数 */
  entries: { name: string; size: number }[] | null
  /** 参与导出的消息条数 */
  messageCount: number
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
  /** 已上传头像的公开读取地址；未上传时为 null。 */
  avatarUrl: string | null
  disabled: boolean
  /** 已由管理员重置密码，正等待用户使用临时密码登录并设置新密码。 */
  mustChangePassword: boolean
  /** 是否允许分享：null=随全局，true/false=按用户覆盖 */
  canShare: boolean | null
  createdAt: number
  /** 最近一次密码登录时间；不代表最近一次模型请求。 */
  lastLoginAt: number | null
  conversationCount: number
}

/** 管理员重置用户密码后的单次响应；临时密码不会持久化明文。 */
export interface AdminPasswordResetResult {
  temporaryPassword: string
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
  /** 对话生成对应的 run；标题总结及 run 已被级联删除的历史事件为 null。 */
  runId: string | null
  /** 请求发生时的会话快照；会话删除后仍保留该值用于审计关联。 */
  conversationId: string | null
  userId: string | null
  username: string | null
  providerId: string | null
  providerLabel: string | null
  /** 请求时的上游模型 ID 快照。 */
  modelLabel: string | null
  /** 请求时的模型外显名称；迁移前记录在模型仍存在时由当前配置补齐。 */
  modelDisplayName: string | null
  /** 请求类型：chat=用户对话，title=会话标题总结 */
  kind: UsageLogKind
  inputTokens: number
  cacheWriteTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  imageTokens: number
  /** 已结算调用的生命周期终态；不再从 success 布尔值猜测。 */
  outcome: UsageOutcome
  /** 终止原因，例如 max_output_tokens、refusal、content_filter、user_cancelled。 */
  terminalReason: string | null
  /** 供列表展示与筛选的稳定分类，由 outcome + terminalReason 派生。 */
  result: UsageResult
  /** 旧额度/聚合兼容字段；请求事件状态不得再直接使用它。 */
  success: boolean
  errorType: string | null
  costUsd: number
  /** 该次请求保存的原始 reasoning_effort 值，不映射为模型配置的展示描述。 */
  reasoningEffort: string | null
  /** 从生成引擎开始到 run 终态的墙钟耗时；关联 run 不存在时为 null。 */
  durationMs: number | null
  /** 从首次实际向上游发送 HTTP 请求到首次成功响应头；仅失败响应可用时取首次失败响应。 */
  upstreamResponseLatencyMs: number | null
  /** 从生成引擎开始到首个可见正文 delta 的墙钟延时。 */
  firstTokenLatencyMs: number | null
  /** 输出 Token /（总耗时 - 首字延时）；无法取得首字事件时为 null。 */
  generationTokensPerSecond: number | null
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
    /** legacy success=true 占比；截断与取消不算上游失败。 */
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
  /** legacy success=true 占比；截断与取消不算上游失败。 */
  successRate: number // 0-1
  /** 筛选范围内最近一条用量日志的时间。 */
  lastUsageAt: number | null
  topModels: { model: string; calls: number }[]
}

/** 管理端登录会话。 */
export interface AdminSessionDTO {
  id: string
  userId: string
  username: string
  userAgent: string | null
  loginIp: string | null
  lastSeenIp: string | null
  lastSeenAt: number | null
  createdAt: number
  expiresAt: number
}

// ===================== 全局设置 / 分享 =====================

/** 全局应用设置（管理员可改）。 */
export interface AppConfigDTO {
  registrationRequiresInviteCode: boolean
  sharingEnabled: boolean
  /** 是否在助手消息用量明细中展示本次预估成本。 */
  showCost: boolean
  /** 仅影响聊天消息用量行；成本存储与后台统计始终保持 USD。 */
  costCurrency: CostCurrency
  titleEnabled: boolean
  titleModelId: string | null
  titlePrompt: string | null
  /** 用户限额总开关；关闭时不做任何判定，配置与用量计数完整保留。 */
  quotaEnabled: boolean
  /** 日历周期（天/周/月）的边界时区（IANA）。 */
  quotaTimezone: string
  /** 周窗口的起始日。 */
  quotaWeekStart: QuotaWeekStart
  /** 用户端「即将用尽」提示的触发占比（0–1）。 */
  quotaWarnThreshold: number
}

/** 聊天消息用量行的成本展示上下文。 */
export interface MessageCostDisplayDTO {
  currency: CostCurrency
  /** 仅 currency=CNY 时可能存在；实时获取失败时为 null，前端回退显示原始 USD。 */
  usdToCnyRate: number | null
}

// ===================== 用户限额 =====================

/** 限额策略模板；rules 为空数组即「无限额度」策略。 */
export interface QuotaPolicyDTO {
  id: string
  name: string
  description: string | null
  rules: QuotaRule[]
  /** 未显式绑定策略的用户使用该策略 */
  isDefault: boolean
  sort: number
  createdAt: number
  updatedAt: number
}

/** 管理端策略列表：额外带绑定人数（含通过「默认策略」间接绑定的人数）。 */
export interface AdminQuotaPolicyDTO extends QuotaPolicyDTO {
  boundUserCount: number
}

/** 一条仍然有效的临时额度（周期结束或到期后自动失效）。 */
export interface QuotaGrantDTO {
  id: string
  ruleId: string | null
  bucketKey: string | null
  metric: QuotaMetric
  amount: number
  note: string | null
  /** 失效时刻；null=不会自动失效（仅「永久累计」窗口可能出现） */
  expiresAt: number | null
  createdAt: number
  createdByName: string | null
}

/** 管理端可见的周期调整记录（临时额度 + 手动重置）。 */
export interface QuotaAdjustmentDTO extends QuotaGrantDTO {
  kind: QuotaAdjustmentKind
  effectiveFrom: number
  periodStart: number
  /** 是否仍作用于当前周期（周期已切换或已过期则为 false） */
  active: boolean
}

/**
 * 一个「额度桶」的实时用量。
 * 「各自独立」的规则会按目标展开成多个桶（每个模型/分组一条），
 * 「共享额度」与「全部模型」只有一个桶（bucketKey=null）。
 * 数组顺序与策略 / 专属规则的展示顺序一致；前端按 ruleId 收拢后再渲染。
 */
export interface QuotaBucketUsageDTO {
  ruleId: string
  bucketKey: string | null
  /** 桶的展示名（模型显示名 / 分组名）；单桶规则为 null */
  bucketLabel: string | null
  /**
   * 共享额度（或「全部模型」被部分接管后）实际覆盖的模型展示名。
   * 各自独立桶为 null（每个桶已有 `bucketLabel`）；仍覆盖全部可用模型时也为 null。
   */
  targetLabels: string[] | null
  /** 优先级接管后该桶实际覆盖的模型；null 表示仍覆盖全部可用模型。 */
  effectiveModelIds: string[] | null
  label: string | null
  source: QuotaRuleSource
  scope: QuotaScope
  metric: QuotaMetric
  window: QuotaWindow
  limit: QuotaLimit
  /** 规则优先级（0=默认档，数字越大越优先） */
  priority: number
  used: number
  granted: number
  /** 基础上限 + 临时额度；null=无限额度 */
  effectiveLimit: number | null
  remaining: number | null
  /** 已用占比，可能 >1（暂停限额或单次超支）；null=无限额度 */
  percent: number | null
  blocked: boolean
  /** 首次请求起算窗口是否已有活动周期；其他窗口恒为 true。 */
  periodActive: boolean
  /** 当前周期起点（窗口的真实起点，与临时额度/重置记录的绑定键一致） */
  periodStart: number
  /** 实际计量起点：日历/滚动/永久累计被手动重置后会晚于 periodStart；首次请求周期重置后回到未启动（与 periodStart 同为 0） */
  usageStart: number
  /** 下次整段重置时刻；滚动窗口、永久累计和未启动的首次请求周期为 null */
  periodEnd: number | null
  grants: QuotaGrantDTO[]
  /** 规则当前失效（如引用了已删除的分组）：不参与拦截，管理端标注 */
  invalid: boolean
  /** 桶内模型全部被更高优先级规则接管：不计量也不拦截，管理端标注 */
  shadowed: boolean
}

/** 用户自己的额度视图；quotaEnabled=false 时只返回 `enabled:false`。 */
export interface MyQuotaDTO {
  enabled: boolean
  /** 管理员已暂停限额：不拦截，但用量仍在累计 */
  paused: boolean
  unlimited: boolean
  /** 当前限额是否阻塞该用户可用的全部模型；暂停限额或没有可用模型时为 false */
  allModelsBlocked: boolean
  policyName: string | null
  warnThreshold: number
  rules: QuotaBucketUsageDTO[]
  /** 额度已用尽、当前不可用的模型（DB id） */
  blockedModelIds: string[]
}

/** 管理端用户限额列表的一行。 */
export interface AdminUserQuotaDTO {
  userId: string
  username: string
  displayName: string | null
  /** 与账号中心同源；未上传时为 null，前端回退姓名首字母。 */
  avatarUrl: string | null
  role: UserRole
  disabled: boolean
  policyId: string | null
  policyName: string | null
  /** 未显式绑定策略，当前跟随默认策略 */
  usingDefaultPolicy: boolean
  enforcementPaused: boolean
  pausedAt: number | null
  note: string | null
  unlimited: boolean
  /** 用户级覆写条数（含专属规则），列表显示「已覆写 N 项」 */
  overrideCount: number
  /** 当前全部额度桶；包含失效、被更高优先级接管及显式豁免的规则，管理端不得隐藏。顺序与策略展示顺序一致。 */
  rules: QuotaBucketUsageDTO[]
  blocked: boolean
  /** 最近一条模型请求用量日志的时间，与账号登录时间无关。 */
  lastUsageAt: number | null
}

/** 单个用户的限额明细（管理端弹窗 / 用户详情页）。 */
export interface AdminUserQuotaDetailDTO {
  userId: string
  username: string
  displayName: string | null
  /** 本快照的周期边界时区；前端必须用它格式化 periodStart / periodEnd / usageStart。 */
  quotaTimezone: string
  warnThreshold: number
  policyId: string | null
  policyName: string | null
  usingDefaultPolicy: boolean
  enforcementPaused: boolean
  pausedAt: number | null
  note: string | null
  overrides: UserQuotaOverrides
  effectiveRules: EffectiveQuotaRule[]
  rules: QuotaBucketUsageDTO[]
  adjustments: QuotaAdjustmentDTO[]
  /** 按模型的消费构成（默认近 30 天，随查询参数变化） */
  byModel: UsageModelStatDTO[]
}

/** 保存前预览：草稿策略/覆写按真实用量算出的最终生效结果。 */
export interface QuotaPreviewDTO {
  unlimited: boolean
  rules: QuotaBucketUsageDTO[]
  /** 保存后会立即处于「已耗尽」的桶（管理端给出警示） */
  blockedRules: QuotaBucketUsageDTO[]
}

// ===================== 个人使用情况 =====================

/** 热力图的一格（按用户本地日聚合）。 */
export interface UsageHeatmapCellDTO {
  /** YYYY-MM-DD（用户本地日） */
  date: string
  requests: number
  totalTokens: number
  costUsd: number
}

export interface UsageModelStatDTO {
  modelId: string | null
  modelLabel: string
  requests: number
  totalTokens: number
  costUsd: number
}

export interface UsageTrendPointDTO {
  ts: number
  requests: number
  totalTokens: number
  costUsd: number
}

/** 个人使用情况面板的一次性数据包。 */
export interface UsageStatsDTO {
  /** 当前窗口视图（今日 / 本周 / 本月 / 本年） */
  view: UsageStatsView
  /** 窗口起点（含）与终点（不含），按用户本地时区的自然周期边界 */
  windowStart: number
  windowEnd: number
  /** 趋势分桶粒度，由视图派生 */
  granularity: UsageTrendGranularity
  /** 热力图覆盖天数；恒为「近一年」视角，与 view 无关 */
  rangeDays: number
  totals: {
    /** 以下指标均按当前窗口统计（对话/消息按窗口内新建计） */
    conversations: number
    messages: number
    requests: number
    totalTokens: number
    costUsd: number
    imageGenerations: number
    /** 窗口内有请求的天数（本地日） */
    activeDays: number
    /** 连续活跃天数按「近一年」滚动计算，不随窗口变化 */
    currentStreak: number
    longestStreak: number
  }
  heatmap: UsageHeatmapCellDTO[]
  byModel: UsageModelStatDTO[]
  /** 24 项，索引=本地小时 */
  byHour: number[]
  /** 7 项，索引 0=周日 */
  byWeekday: number[]
  trend: UsageTrendPointDTO[]
  topModel: UsageModelStatDTO | null
  busiestHour: number | null
  busiestWeekday: number | null
  firstUsedAt: number | null
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

/** 管理员按需读取的公告完整受众范围；公告列表只返回人数，避免重复传输大名单。 */
export interface AnnouncementAudienceDTO {
  audience: AnnouncementAudience
  /** selected 模式下的完整用户 ID 名单；all 模式下为空数组。 */
  userIds: string[]
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
}

/** 用户自己/管理员看到的一条分享记录。 */
export interface SharedChatDTO {
  id: string
  token: string
  conversationId: string
  title: string | null
  showAvatar: boolean
  showName: boolean
  /** 是否包含用户上传的图片/文件 */
  includeAttachments: boolean
  /** 快照内消息条数 */
  messageCount: number
  expiresAt: number | null
  revoked: boolean
  createdAt: number
  /** 快照最近一次刷新时间 */
  updatedAt: number
  /** 快照内的消息 id（会话属主查询单条分享时返回，用于分享弹窗回显选择） */
  sharedMessageIds?: string[]
  /** 管理端列表附带的拥有者用户名 */
  ownerUsername?: string
}

/** 公开分享视图（无需登录）。 */
export interface PublicShareDTO {
  title: string | null
  messages: MessageDTO[]
  /** 公开页是否展示消息成本；读取时使用当前全局设置。 */
  showCost: boolean
  /** 只用于公开聊天消息用量行，不改变快照中保存的原始 USD 成本。 */
  messageCostDisplay: MessageCostDisplayDTO
  createdAt: number
  /** 快照最近一次刷新时间 */
  updatedAt: number
  /** false 时用户上传的图片/文件已被属主排除，页面以文字占位显示 */
  attachmentsIncluded: boolean
  owner: { name: string | null; avatarUrl: string | null }
}
