import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { newId } from '../lib/id'
// 注意：schema.ts 仅用相对路径导入（含 type-only），以规避 drizzle-kit 对 @shared/* 别名解析的不确定性。
import type {
  AnnouncementAudience,
  AnnouncementChannel,
  AnnouncementLevel,
  AnnouncementStatus,
  ContentPart,
  CostCurrency,
  MessageStatus,
  ModelAccessMode,
  ModelCapabilities,
  ModelHardParams,
  ModelKind,
  ModelParams,
  ModelPricing,
  ProviderProtocol,
  QuotaAdjustmentKind,
  QuotaMetric,
  QuotaRule,
  QuotaWeekStart,
  ReasoningEffort,
  StoredReasoningEffortOption,
  Role,
  RunState,
  SearchAction,
  StoredModelGroupIcon,
  StoredModelIcon,
  StoredModelTag,
  UrlCitation,
  UsageLogKind,
  UserPreferences,
  UserQuotaOverrides,
  UserRole,
} from '../../shared/types/domain'
import type { MessageDTO } from '../../shared/types/api'
import type { ProviderReplayContext } from '../provider/reasoning-replay'

// ---- 通用列工厂（每次返回新的 builder 实例）----
const pk = () => text('id').primaryKey().$defaultFn(newId)
const ts = (name: string) => integer(name, { mode: 'timestamp_ms' })
const createdAt = () =>
  ts('created_at')
    .notNull()
    .$defaultFn(() => new Date())
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())

// ========================= 账号 / 会话 =========================

export const users = sqliteTable(
  'users',
  {
    id: pk(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<UserRole>().notNull().default('user'),
    displayName: text('display_name'),
    avatarPath: text('avatar_path'),
    // 是否允许分享聊天：null=随全局设置，true/false=按用户覆盖
    canShare: integer('can_share', { mode: 'boolean' }),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    // 管理员重置密码后置为 true；此时会话只能访问完成改密所需的最小认证接口。
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: createdAt(),
    // 仅在密码登录成功时更新；模型请求时间应从 usage_logs 聚合，二者不可混用。
    lastLoginAt: ts('last_login_at'),
  },
  (t) => [uniqueIndex('users_username_unique').on(t.username)],
)

export const inviteCodes = sqliteTable(
  'invite_codes',
  {
    id: pk(),
    code: text('code').notNull(),
    note: text('note'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    maxUses: integer('max_uses').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invite_codes_code_unique').on(t.code)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
)

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: text('theme').$type<'system' | 'light' | 'dark'>().notNull().default('system'),
  defaultModelId: text('default_model_id'),
  // 列名沿用 ui_prefs（内部命名，避免迁移改名提示）；TS 侧以 preferences 暴露账户级偏好。
  preferences: text('ui_prefs', { mode: 'json' }).$type<Partial<UserPreferences>>(),
  updatedAt: updatedAt(),
})

/** 全局应用设置（单例：始终只维护一行）。 */
export const appSettings = sqliteTable('app_settings', {
  id: pk(),
  // 是否要求新用户注册时填写邀请码；首位管理员始终例外
  registrationRequiresInviteCode: integer('registration_requires_invite_code', {
    mode: 'boolean',
  })
    .notNull()
    .default(true),
  // 是否允许用户分享聊天（全局开关）
  sharingEnabled: integer('sharing_enabled', { mode: 'boolean' }).notNull().default(true),
  // 是否在助手消息用量明细中展示本次预估成本
  showCost: integer('show_cost', { mode: 'boolean' }).notNull().default(true),
  // 仅控制聊天消息用量行的展示币种；成本与汇率不以 CNY 形式落库
  costCurrency: text('cost_currency').$type<CostCurrency>().notNull().default('USD'),
  // 标题自动总结
  titleEnabled: integer('title_enabled', { mode: 'boolean' }).notNull().default(true),
  titleModelId: text('title_model_id'),
  titlePrompt: text('title_prompt'),
  // 用户限额总开关：关闭时完全不判定，策略/覆写/用量计数全部保留，用户端零感知。
  quotaEnabled: integer('quota_enabled', { mode: 'boolean' }).notNull().default(false),
  // 日历周期（天/周/月）的边界时区与周起始日；两种按小时窗口与之无关。
  quotaTimezone: text('quota_timezone').notNull().default('Asia/Shanghai'),
  quotaWeekStart: text('quota_week_start').$type<QuotaWeekStart>().notNull().default('mon'),
  // 用户端「即将用尽」提示的触发占比。
  quotaWarnThreshold: real('quota_warn_threshold').notNull().default(0.8),
  updatedAt: updatedAt(),
})

// ========================= 站内公告 =========================

/**
 * 站内公告（多条、可排期）。可见性在读取时按
 * status='published' 且 now ∈ [publishAt ?? -∞, expiresAt ?? +∞] 计算，
 * 无需定时任务（本项目无 cron）。
 */
export const announcements = sqliteTable(
  'announcements',
  {
    id: pk(),
    title: text('title').notNull(),
    // 正文（Markdown 源码，渲染复用 chat/Markdown.tsx，原始 HTML 惰性化）
    body: text('body').notNull(),
    level: text('level').$type<AnnouncementLevel>().notNull().default('info'),
    channel: text('channel').$type<AnnouncementChannel>().notNull().default('silent'),
    audience: text('audience').$type<AnnouncementAudience>().notNull().default('all'),
    status: text('status').$type<AnnouncementStatus>().notNull().default('draft'),
    // 置顶：通知中心与横幅排序时优先
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    // 强提示弹窗对每个用户最多自动弹出的次数（点「我知道了」后不再弹）
    maxImpressions: integer('max_impressions').notNull().default(1),
    // 生效起点：null=发布后立即可见；未来时间=定时发布
    publishAt: ts('publish_at'),
    // 失效终点：null=永不过期
    expiresAt: ts('expires_at'),
    // 创建者（无强关联需求，删用户后保留公告）
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('announcements_status_publish_idx').on(t.status, t.publishAt),
    index('announcements_pinned_idx').on(t.pinned),
  ],
)

/**
 * 每用户对公告的状态（复合主键）。支持逐条已读与「已读 X/Y 人」统计。
 * - readAt：已读/已确认时间；null=仅曝光过但未确认。
 * - impressions：强提示弹窗对该用户已自动弹出的次数（用于「通知次数」上限）。
 */
export const announcementReads = sqliteTable(
  'announcement_reads',
  {
    announcementId: text('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // null=未确认；有值=已读（bell 未读数、已读统计均以此为准）
    readAt: ts('read_at'),
    // 强弹窗已自动弹出次数
    impressions: integer('impressions').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.announcementId, t.userId] }),
    index('announcement_reads_user_idx').on(t.userId),
  ],
)

// ========================= Provider / 模型 =========================

export const providers = sqliteTable('providers', {
  id: pk(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  // API Key 明文存库；管理员列表 DTO 固定脱敏，编辑详情接口按需返回完整值。
  apiKey: text('api_key').notNull(),
  protocol: text('protocol').$type<ProviderProtocol>().notNull().default('openai'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * 模型分组（管理员定义的全站结构，非用户私有）：驱动用户端模型选择器的
 * 「平铺分组标题」与「二级目录」两种视图。排序沿用 models.sort 的稀疏步长约定，
 * 不用 folders 的 createdAt 排序——分组顺序需要管理员显式拖拽控制。
 */
export const modelGroups = sqliteTable('model_groups', {
  id: pk(),
  name: text('name').notNull(),
  // 图标（lobe / 自定义 / Emoji / 显式无图标）；null=默认文件夹图形。
  icon: text('icon', { mode: 'json' }).$type<StoredModelGroupIcon>(),
  // 默认文件夹图形颜色（#RRGGBB）；显式图标或无图标模式下服务层固定归一为 null。
  color: text('color'),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** 管理员上传的自定义图标库：上传一次，可被多个模型/分组引用。 */
export const modelIcons = sqliteTable('model_icons', {
  id: pk(),
  name: text('name').notNull(),
  storagePath: text('storage_path').notNull(),
  mime: text('mime').notNull(),
  createdAt: createdAt(),
})

export const models = sqliteTable(
  'models',
  {
    id: pk(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    // 上游模型 id，如 gpt-5.5。同一供应商下允许多条同 id 记录：
    // 参数/提示词不同的配置视为不同的模型实例（对用户表现为两个模型）。
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    // 用户可见的模型简介（模型选择器 ⓘ 展示）；null=未配置。
    description: text('description'),
    // 旧记录为 string[]，新记录写 {label,color}[]；读取时由共享 helper 统一归一化。
    tags: text('tags', { mode: 'json' }).$type<StoredModelTag[]>(),
    // 用户可见图标；null=自动识别品牌，{type:'initial'}=显式使用名称首字母。
    icon: text('icon', { mode: 'json' }).$type<StoredModelIcon>(),
    // 所属分组；null=未分组。删除分组时置 null（组内模型不跟着被删）。
    groupId: text('group_id').references(() => modelGroups.id, { onDelete: 'set null' }),
    kind: text('kind').$type<ModelKind>().notNull().default('responses'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    // 用户端开放范围；与 enabled（全局总开关）正交。selected 即使名单为空也保持拒绝。
    accessMode: text('access_mode').$type<ModelAccessMode>().notNull().default('all'),
    capabilities: text('capabilities', { mode: 'json' }).$type<ModelCapabilities>().notNull(),
    defaultSystemPrompt: text('default_system_prompt'),
    defaultParams: text('default_params', { mode: 'json' }).$type<ModelParams>(),
    hardParams: text('hard_params', { mode: 'json' }).$type<ModelHardParams>(),
    pricing: text('pricing', { mode: 'json' }).$type<ModelPricing>(),
    // 旧记录为 string[]，新记录写 {value,description}[]；读取时由共享 helper 统一归一化。
    allowedEfforts: text('allowed_efforts', { mode: 'json' }).$type<
      StoredReasoningEffortOption[]
    >(),
    defaultEffort: text('default_effort').$type<ReasoningEffort>(),
    // 历史 SQL 列名保留 replay_reasoning；TS 语义覆盖 Responses reasoning 与 Anthropic blocks。
    replayProviderContext: integer('replay_reasoning', { mode: 'boolean' })
      .notNull()
      .default(false),
    defaultWebSearch: integer('default_web_search', { mode: 'boolean' }).notNull().default(false),
    // X 搜索（xAI x_search）默认开关；与联网搜索相互独立。
    defaultXSearch: integer('default_x_search', { mode: 'boolean' }).notNull().default(false),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // 同 id 多实例：不再有 (provider_id, model_id) 唯一约束，仅保留供应商查询索引。
  (t) => [index('models_provider_idx').on(t.providerId), index('models_group_idx').on(t.groupId)],
)

/**
 * 模型的按用户白名单。开放语义由 models.access_mode 显式决定，绝不根据本表是否为空推断，
 * 避免删除最后一位用户时意外把模型开放给所有人。
 */
export const modelUserAccess = sqliteTable(
  'model_user_access',
  {
    modelId: text('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.modelId, t.userId] }),
    // 用户模型列表按 user_id 过滤；反向索引避免为每个模型扫描整张白名单表。
    index('model_user_access_user_idx').on(t.userId, t.modelId),
  ],
)

// ========================= 用户限额（配额）=========================

/**
 * 限额策略模板（管理员定义的全站结构）。`rules` 为空数组即「无限额度」策略。
 *
 * 规则内引用的模型 / 分组 id 存在 JSON 里，**没有 FK 级联**：模型或分组被删除后，
 * 对应的额度桶在解析时自然消失（分组规则整体视为失效），不需要迁移数据。
 * 排序沿用 models / model_groups 的稀疏步长约定（重排写 `(index+1)*100`）。
 */
export const quotaPolicies = sqliteTable('quota_policies', {
  id: pk(),
  name: text('name').notNull(),
  description: text('description'),
  rules: text('rules', { mode: 'json' }).$type<QuotaRule[]>().notNull(),
  // 未在 user_quotas 显式绑定策略的用户跟随该策略；服务层保证至多一行为 true。
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * 用户级限额配置。**只为「有显式配置」的用户建行**：没有行等价于
 * 「跟随默认策略 + 无覆写 + 未暂停」，因此新用户零配置即可工作。
 *
 * `enforcementPaused` 是临时绕过拦截的开关（用量仍照常累计），
 * 与「封禁账号」（`users.disabled`）是两件事。
 */
export const userQuotas = sqliteTable('user_quotas', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  // 删除策略后回退到默认策略（服务层同时显式置 null 并保留原 updatedAt）。
  policyId: text('policy_id').references(() => quotaPolicies.id, { onDelete: 'set null' }),
  overrides: text('overrides', { mode: 'json' }).$type<UserQuotaOverrides>(),
  enforcementPaused: integer('enforcement_paused', { mode: 'boolean' }).notNull().default(false),
  pausedAt: ts('paused_at'),
  pausedBy: text('paused_by').references(() => users.id, { onDelete: 'set null' }),
  note: text('note'),
  updatedAt: updatedAt(),
})

/**
 * 周期内调整，表达两个只影响「当前周期」的管理动作，绝不改写历史用量：
 * - `grant`：临时增加额度（`amount` 叠加到上限），到期或周期切换后自动失效；
 * - `reset`：手动重置当前周期（把统计起点抬到 `effectiveFrom`）。
 *
 * `periodStart` 记录创建时所处周期的起点：当前周期起点与之不同即视为失效，
 * 因此即使 `expiresAt` 因时区/配置调整而失准，赠送额度也不会跨周期复活。
 */
export const quotaAdjustments = sqliteTable(
  'quota_adjustments',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<QuotaAdjustmentKind>().notNull(),
    // 目标规则 id（JSON 规则的稳定 id，无 FK）；null=作用于该用户全部规则（重置全部周期）。
    ruleId: text('rule_id'),
    // 「各自独立」规则的具体桶（模型 DB id / 分组 id）；null=整条规则的单一桶。
    bucketKey: text('bucket_key'),
    metric: text('metric').$type<QuotaMetric>().notNull(),
    // grant 的额度增量（cost=USD，requests=次数）；reset 为 null。
    amount: real('amount'),
    effectiveFrom: ts('effective_from').notNull(),
    periodStart: ts('period_start').notNull(),
    // grant 失效时刻；「永久累计」窗口可为 null（永不自动失效）。
    expiresAt: ts('expires_at'),
    note: text('note'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('quota_adjustments_user_created_idx').on(t.userId, t.createdAt),
    index('quota_adjustments_user_rule_idx').on(t.userId, t.ruleId),
  ],
)

/**
 * 「首次请求起算」窗口的活动周期锚点。
 *
 * `bucket_key` 用空字符串表示单桶规则，避免 SQLite 复合主键里的 NULL 破坏唯一性。
 * 周期到期后保留最后一行：下一次获准请求会在同一事务内覆写为新周期。
 */
export const quotaCycles = sqliteTable(
  'quota_cycles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 规则存于 JSON，没有可引用的数据库外键；规则 id 在编辑生命周期内保持稳定。
    ruleId: text('rule_id').notNull(),
    bucketKey: text('bucket_key').notNull().default(''),
    windowHours: integer('window_hours').notNull(),
    startedAt: ts('started_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.ruleId, t.bucketKey] })],
)

// ========================= 会话 / 消息（合并节点+内容的单表分支树）=========================

/** 聊天文件夹（每用户私有）：名称 + 可选主题色/Emoji 图标，支持置顶。 */
export const folders = sqliteTable(
  'folders',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // 主题色（#RRGGBB）；旧记录的 null 在读取时归一为默认黄色
    color: text('color'),
    // 图标 Emoji（可能是多码点序列，如 ZWJ 组合）；null=默认文件夹图标
    emoji: text('emoji'),
    pinnedAt: ts('pinned_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('folders_user_idx').on(t.userId)],
)

export const conversations = sqliteTable(
  'conversations',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    // 所属文件夹；删除文件夹时会话自动移回未分组（set null）
    folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    // 当前可见分支的叶子消息 id（无 DB 级 FK，避免与 messages 循环引用，由应用维护）
    activeLeafId: text('active_leaf_id'),
    systemPromptOverride: text('system_prompt_override'),
    paramsOverride: text('params_override', { mode: 'json' }).$type<ModelParams>(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    pinnedAt: ts('pinned_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('conversations_user_updated_idx').on(t.userId, t.updatedAt),
    index('conversations_user_pinned_idx').on(t.userId, t.pinnedAt),
    index('conversations_folder_idx').on(t.folderId),
  ],
)

export const messages = sqliteTable(
  'messages',
  {
    id: pk(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // 自引用分支树（无 DB 级 FK，由应用维护）
    parentId: text('parent_id'),
    role: text('role').$type<Role>().notNull(),
    status: text('status').$type<MessageStatus>().notNull().default('complete'),
    content: text('content', { mode: 'json' }).$type<ContentPart[]>().notNull(),
    // 该用户消息发送时的可信运行环境；仅在构建上游请求时展开为虚拟 system 消息。
    runtimeContext: text('runtime_context'),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    // 关联生成任务（无 DB 级 FK，避免与 runs 循环引用）
    runId: text('run_id'),
    reasoningSummary: text('reasoning_summary'),
    // 历史 SQL 列名保留 reasoning_replay_context；信封可含多种上游 opaque content。
    providerReplayContext: text('reasoning_replay_context', {
      mode: 'json',
    }).$type<ProviderReplayContext>(),
    // 展示用计时快照。独立分支不复制 run 审计记录，仍需保留原消息的耗时明细。
    reasoningDurationMs: integer('reasoning_duration_ms'),
    generationDurationMs: integer('generation_duration_ms'),
    annotations: text('annotations', { mode: 'json' }).$type<UrlCitation[]>(),
    // 检索工具本轮实际执行的动作序列（web_search 的搜索词/打开页面/页内查找与
    // x_search 的 X 站内检索按真实交错顺序合并），供 UI 复现检索过程。
    searchActions: text('search_actions', { mode: 'json' }).$type<SearchAction[]>(),
    inputTokens: integer('input_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    cachedTokens: integer('cached_tokens'),
    outputTokens: integer('output_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    totalTokens: integer('total_tokens'),
    // 按请求时模型价格快照计算的展示成本；独立分支复制该值，不依赖用量审计记录。
    costUsd: real('cost_usd'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId),
    index('messages_conversation_parent_idx').on(t.conversationId, t.parentId),
  ],
)

export const attachments = sqliteTable(
  'attachments',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: text('message_id'), // 上传后才关联消息；无 DB 级 FK，由应用维护
    kind: text('kind').$type<'image' | 'file'>().notNull(),
    mime: text('mime').notNull(),
    filename: text('filename').notNull(),
    byteSize: integer('byte_size').notNull(),
    storagePath: text('storage_path').notNull(),
    sha256: text('sha256'),
    createdAt: createdAt(),
  },
  (t) => [
    // 前缀仍覆盖按 messageId 查询，同时加速“未绑定且已过期”的后台 TTL 扫描。
    index('attachments_message_created_idx').on(t.messageId, t.createdAt, t.id),
    index('attachments_user_idx').on(t.userId),
  ],
)

/** 分享的聊天（快照：分享时定格当时可见路径，后续新消息不泄露）。 */
export const sharedChats = sqliteTable(
  'shared_chats',
  {
    id: pk(),
    token: text('token').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    // 分享时定格的可见消息路径（MessageDTO[]；可为手动选择的分支子集）
    snapshot: text('snapshot', { mode: 'json' }).$type<MessageDTO[]>().notNull(),
    showAvatar: integer('show_avatar', { mode: 'boolean' }).notNull().default(true),
    showName: integer('show_name', { mode: 'boolean' }).notNull().default(true),
    // 是否包含用户上传的图片/文件；false 时快照内的引用已剥离，分享页以文字占位显示
    includeAttachments: integer('include_attachments', { mode: 'boolean' }).notNull().default(true),
    expiresAt: ts('expires_at'),
    revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shared_chats_token_unique').on(t.token),
    index('shared_chats_owner_idx').on(t.ownerId),
  ],
)

// ========================= run 状态机 / 事件日志 =========================

export const runs = sqliteTable(
  'runs',
  {
    id: pk(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 关联的助手消息 id（无 DB 级 FK，避免与 messages 循环引用）
    assistantMessageId: text('assistant_message_id'),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    state: text('state').$type<RunState>().notNull().default('queued'),
    idempotencyKey: text('idempotency_key'),
    requestParams: text('request_params', { mode: 'json' }).$type<Record<string, unknown>>(),
    instructions: text('instructions'),
    upstreamResponseId: text('upstream_response_id'),
    lastSequenceNumber: integer('last_sequence_number').notNull().default(-1),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    incompleteReason: text('incomplete_reason'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('runs_idempotency_unique').on(t.idempotencyKey),
    index('runs_conversation_idx').on(t.conversationId),
    index('runs_user_state_idx').on(t.userId, t.state),
  ],
)

export const runEvents = sqliteTable(
  'run_events',
  {
    id: pk(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    type: text('type').notNull(),
    // 已去除 obfuscation 的上游事件 / 合成事件；绝不存图片 b64（只存文件引用）
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('run_events_run_seq_unique').on(t.runId, t.sequenceNumber)],
)

// ========================= 用量 / 错误日志（删除后仍保留，便于统计审计）=========================

export const usageLogs = sqliteTable(
  'usage_logs',
  {
    id: pk(),
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    // 冗余存储以便模型/用户删除后仍可统计
    modelLabel: text('model_label'),
    providerLabel: text('provider_label'),
    // 请求发起时的价格快照；后续改价或删除模型不得改写历史成本。
    pricingSnapshot: text('pricing_snapshot', { mode: 'json' }).$type<ModelPricing>(),
    conversationId: text('conversation_id'),
    // 请求类型：两者都进入成本/审计统计；只有 chat 会被用户额度规则聚合。
    kind: text('kind').$type<UsageLogKind>().notNull().default('chat'),
    inputTokens: integer('input_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    imageTokens: integer('image_tokens').notNull().default(0),
    success: integer('success', { mode: 'boolean' }).notNull().default(true),
    errorType: text('error_type'),
    // chat 的额度归属按请求获准/入队时刻计算；title 不参与额度并保持为空。
    // 迁移前的 chat 旧数据为空时，额度聚合安全回退 created_at。
    quotaAt: ts('quota_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('usage_logs_user_created_idx').on(t.userId, t.createdAt),
    index('usage_logs_user_quota_idx').on(t.userId, t.quotaAt),
    index('usage_logs_created_idx').on(t.createdAt),
    index('usage_logs_provider_idx').on(t.providerId),
  ],
)

export const errorLogs = sqliteTable(
  'error_logs',
  {
    id: pk(),
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    scope: text('scope').$type<'upstream' | 'server' | 'stream' | 'frontend'>().notNull(),
    errorType: text('error_type'),
    code: text('code'),
    httpStatus: integer('http_status'),
    message: text('message').notNull(),
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('error_logs_created_idx').on(t.createdAt),
    index('error_logs_user_idx').on(t.userId),
  ],
)
