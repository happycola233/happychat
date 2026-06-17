import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { newId } from '../lib/id'
// 注意：schema.ts 仅用相对路径导入（含 type-only），以规避 drizzle-kit 对 @shared/* 别名解析的不确定性。
import type {
  ContentPart,
  MessageStatus,
  ModelCapabilities,
  ModelHardParams,
  ModelKind,
  ModelParams,
  ReasoningEffort,
  Role,
  RunState,
  UiPrefs,
  UrlCitation,
  UserRole,
} from '../../shared/types/domain'

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
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    lastActiveAt: ts('last_active_at'),
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
  uiPrefs: text('ui_prefs', { mode: 'json' }).$type<UiPrefs>(),
  updatedAt: updatedAt(),
})

// ========================= Provider / 模型 =========================

export const providers = sqliteTable('providers', {
    id: pk(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    // API Key 明文存库；只在管理员列表 DTO 中脱敏返回，避免前端拿到完整值。
    apiKey: text('api_key').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
})

export const models = sqliteTable(
  'models',
  {
    id: pk(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(), // 上游模型 id，如 gpt-5.5
    displayName: text('display_name').notNull(),
    kind: text('kind').$type<ModelKind>().notNull().default('responses'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    capabilities: text('capabilities', { mode: 'json' }).$type<ModelCapabilities>().notNull(),
    defaultSystemPrompt: text('default_system_prompt'),
    defaultParams: text('default_params', { mode: 'json' }).$type<ModelParams>(),
    hardParams: text('hard_params', { mode: 'json' }).$type<ModelHardParams>(),
    allowedEfforts: text('allowed_efforts', { mode: 'json' }).$type<ReasoningEffort[]>(),
    defaultEffort: text('default_effort').$type<ReasoningEffort>(),
    defaultWebSearch: integer('default_web_search', { mode: 'boolean' }).notNull().default(false),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('models_provider_model_unique').on(t.providerId, t.modelId)],
)

// ========================= 会话 / 消息（合并节点+内容的单表分支树）=========================

export const conversations = sqliteTable(
  'conversations',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    // 当前可见分支的叶子消息 id（无 DB 级 FK，避免与 messages 循环引用，由应用维护）
    activeLeafId: text('active_leaf_id'),
    systemPromptOverride: text('system_prompt_override'),
    paramsOverride: text('params_override', { mode: 'json' }).$type<ModelParams>(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('conversations_user_updated_idx').on(t.userId, t.updatedAt)],
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
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    // 关联生成任务（无 DB 级 FK，避免与 runs 循环引用）
    runId: text('run_id'),
    reasoningSummary: text('reasoning_summary'),
    annotations: text('annotations', { mode: 'json' }).$type<UrlCitation[]>(),
    inputTokens: integer('input_tokens'),
    cachedTokens: integer('cached_tokens'),
    outputTokens: integer('output_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    totalTokens: integer('total_tokens'),
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
  (t) => [index('attachments_message_idx').on(t.messageId)],
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
    // 冗余存储以便模型/用户删除后仍可统计
    modelLabel: text('model_label'),
    providerLabel: text('provider_label'),
    conversationId: text('conversation_id'),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    imageTokens: integer('image_tokens').notNull().default(0),
    success: integer('success', { mode: 'boolean' }).notNull().default(true),
    errorType: text('error_type'),
    createdAt: createdAt(),
  },
  (t) => [index('usage_logs_user_created_idx').on(t.userId, t.createdAt)],
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
  (t) => [index('error_logs_created_idx').on(t.createdAt)],
)
