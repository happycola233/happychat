import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  AttachmentKind,
  ImageOptions,
  JsonObject,
  MessagePart,
  ModelCapabilities,
  ModelType,
  ReasoningEffort,
  RunStatus,
  UsageView,
  UserRole,
  UserStatus
} from "../../shared/types.js";

const nowSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<UserRole>().notNull().default("user"),
    status: text("status").$type<UserStatus>().notNull().default("active"),
    createdAt: text("created_at").notNull().default(nowSql),
    updatedAt: text("updated_at").notNull().default(nowSql)
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email)
  })
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(nowSql)
  },
  (table) => ({
    userIdx: index("sessions_user_idx").on(table.userId)
  })
);

export const inviteCodes = sqliteTable("invite_codes", {
  code: text("code").primaryKey(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull().default(nowSql)
});

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(nowSql),
  updatedAt: text("updated_at").notNull().default(nowSql)
});

export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    upstreamId: text("upstream_id").notNull(),
    displayName: text("display_name").notNull(),
    type: text("type").$type<ModelType>().notNull().default("chat"),
    capabilities: text("capabilities", { mode: "json" }).$type<ModelCapabilities>().notNull(),
    defaultSystemPrompt: text("default_system_prompt").notNull().default(""),
    defaultReasoningEffort: text("default_reasoning_effort")
      .$type<ReasoningEffort>()
      .notNull()
      .default("medium"),
    defaultWebSearch: integer("default_web_search", { mode: "boolean" }).notNull().default(false),
    defaultParams: text("default_params", { mode: "json" })
      .$type<JsonObject>()
      .notNull()
      .default({}),
    extraParams: text("extra_params", { mode: "json" }).$type<JsonObject>().notNull().default({}),
    hardParams: text("hard_params", { mode: "json" }).$type<JsonObject>().notNull().default({}),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(nowSql),
    updatedAt: text("updated_at").notNull().default(nowSql)
  },
  (table) => ({
    providerUpstreamIdx: uniqueIndex("models_provider_upstream_idx").on(
      table.providerId,
      table.upstreamId
    ),
    providerIdx: index("models_provider_idx").on(table.providerId)
  })
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("新的对话"),
    currentLeafNodeId: text("current_leaf_node_id"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(nowSql),
    updatedAt: text("updated_at").notNull().default(nowSql)
  },
  (table) => ({
    userUpdatedIdx: index("conversations_user_updated_idx").on(table.userId, table.updatedAt)
  })
);

export const conversationNodes = sqliteTable(
  "conversation_nodes",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    role: text("role").notNull(),
    messageId: text("message_id"),
    runId: text("run_id"),
    branchIndex: integer("branch_index").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowSql)
  },
  (table) => ({
    conversationIdx: index("nodes_conversation_idx").on(table.conversationId),
    parentIdx: index("nodes_parent_idx").on(table.parentId)
  })
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    role: text("role").notNull(),
    parts: text("parts", { mode: "json" }).$type<MessagePart[]>().notNull(),
    contentText: text("content_text").notNull().default(""),
    modelId: text("model_id").references(() => models.id, { onDelete: "set null" }),
    runId: text("run_id"),
    upstreamResponseId: text("upstream_response_id"),
    reasoningSummary: text("reasoning_summary"),
    usage: text("usage", { mode: "json" }).$type<UsageView>(),
    createdAt: text("created_at").notNull().default(nowSql),
    updatedAt: text("updated_at").notNull().default(nowSql)
  },
  (table) => ({
    conversationIdx: index("messages_conversation_idx").on(table.conversationId),
    nodeIdx: uniqueIndex("messages_node_idx").on(table.nodeId),
    runIdx: index("messages_run_idx").on(table.runId)
  })
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null"
    }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    runId: text("run_id"),
    kind: text("kind").$type<AttachmentKind>().notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    sha256: text("sha256").notNull(),
    upstreamFileId: text("upstream_file_id"),
    createdAt: text("created_at").notNull().default(nowSql)
  },
  (table) => ({
    userIdx: index("attachments_user_idx").on(table.userId),
    messageIdx: index("attachments_message_idx").on(table.messageId)
  })
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "restrict" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    userNodeId: text("user_node_id").notNull(),
    assistantNodeId: text("assistant_node_id").notNull(),
    status: text("status").$type<RunStatus>().notNull().default("queued"),
    abortReason: text("abort_reason"),
    upstreamResponseId: text("upstream_response_id"),
    upstreamSequence: integer("upstream_sequence"),
    inputSnapshot: text("input_snapshot", { mode: "json" })
      .$type<JsonObject>()
      .notNull()
      .default({}),
    requestPayload: text("request_payload", { mode: "json" })
      .$type<JsonObject>()
      .notNull()
      .default({}),
    error: text("error"),
    createdAt: text("created_at").notNull().default(nowSql),
    startedAt: text("started_at"),
    completedAt: text("completed_at")
  },
  (table) => ({
    userIdx: index("runs_user_idx").on(table.userId),
    conversationIdx: index("runs_conversation_idx").on(table.conversationId),
    statusIdx: index("runs_status_idx").on(table.status)
  })
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    upstreamSequence: integer("upstream_sequence"),
    type: text("type").notNull(),
    data: text("data", { mode: "json" }).$type<JsonObject>().notNull(),
    createdAt: text("created_at").notNull().default(nowSql)
  },
  (table) => ({
    runIdx: index("run_events_run_idx").on(table.runId, table.id)
  })
);

export const usageLogs = sqliteTable(
  "usage_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    providerId: text("provider_id").references(() => providers.id, { onDelete: "set null" }),
    modelId: text("model_id").references(() => models.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null"
    }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    success: integer("success", { mode: "boolean" }).notNull().default(true),
    errorReason: text("error_reason"),
    createdAt: text("created_at").notNull().default(nowSql)
  },
  (table) => ({
    createdIdx: index("usage_created_idx").on(table.createdAt),
    userIdx: index("usage_user_idx").on(table.userId),
    modelIdx: index("usage_model_idx").on(table.modelId)
  })
);

export const errorLogs = sqliteTable(
  "error_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    providerId: text("provider_id").references(() => providers.id, { onDelete: "set null" }),
    modelId: text("model_id").references(() => models.id, { onDelete: "set null" }),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null"
    }),
    source: text("source").notNull(),
    message: text("message").notNull(),
    detail: text("detail"),
    createdAt: text("created_at").notNull().default(nowSql)
  },
  (table) => ({
    createdIdx: index("errors_created_idx").on(table.createdAt)
  })
);

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currentModelId: text("current_model_id"),
  webSearchEnabled: integer("web_search_enabled", { mode: "boolean" }).notNull().default(false),
  reasoningEffort: text("reasoning_effort").$type<ReasoningEffort>().notNull().default("medium"),
  imageOptions: text("image_options", { mode: "json" }).$type<ImageOptions>().notNull().default({}),
  updatedAt: text("updated_at").notNull().default(nowSql)
});

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<JsonObject>().notNull(),
  updatedAt: text("updated_at").notNull().default(nowSql)
});

export const userRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  preferences: one(userPreferences)
}));

export type UserRow = typeof users.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;
export type ModelRow = typeof models.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type NodeRow = typeof conversationNodes.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
