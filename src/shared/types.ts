export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";
export type MessageRole = "system" | "user" | "assistant" | "tool";
export type RunStatus = "queued" | "connecting" | "streaming" | "completed" | "failed" | "canceled";
export type ModelType = "chat" | "image";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AttachmentKind = "image" | "file" | "generated_image";

export type JsonObject = Record<string, unknown>;

export type ModelCapabilities = {
  text: boolean;
  imageInput: boolean;
  fileInput: boolean;
  webSearch: boolean;
  reasoning: boolean;
  reasoningSummary: boolean;
  imageGeneration: boolean;
};

export type ImageOptions = {
  size?: "auto" | "1024x1024" | "1536x1024" | "1024x1536";
  quality?: "auto" | "low" | "medium" | "high";
  format?: "png" | "jpeg" | "webp";
  count?: number;
};

export type ChatOptions = {
  webSearch?: boolean;
  reasoningEffort?: ReasoningEffort;
  imageGeneration?: boolean;
  imageOptions?: ImageOptions;
};

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "image"; attachmentId: string; url?: string; mimeType?: string; name?: string }
  | { type: "file"; attachmentId: string; fileId?: string; mimeType?: string; name?: string }
  | { type: "generated_image"; attachmentId: string; url: string; mimeType?: string; name?: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; name: string; input?: unknown; output?: unknown };

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
};

export type PublicProvider = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  hasApiKey: boolean;
};

export type PublicModel = {
  id: string;
  providerId: string;
  providerName: string;
  upstreamId: string;
  displayName: string;
  type: ModelType;
  capabilities: ModelCapabilities;
  defaultSystemPrompt: string;
  defaultReasoningEffort: ReasoningEffort;
  defaultWebSearch: boolean;
  defaultParams: JsonObject;
  extraParams: JsonObject;
  hardParams: JsonObject;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  currentLeafNodeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationNodeView = {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: MessageRole;
  messageId: string | null;
  runId: string | null;
  branchIndex: number;
  createdAt: string;
};

export type MessageView = {
  id: string;
  conversationId: string;
  nodeId: string;
  role: MessageRole;
  parts: MessagePart[];
  contentText: string;
  modelId: string | null;
  runId: string | null;
  upstreamResponseId: string | null;
  reasoningSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationDetail = ConversationSummary & {
  nodes: ConversationNodeView[];
  messages: MessageView[];
  activePath: ConversationNodeView[];
};

export type AttachmentView = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
};

export type RunEventPayload =
  | { kind: "status"; status: RunStatus; message?: string }
  | { kind: "text_delta"; delta: string }
  | { kind: "reasoning_delta"; delta: string }
  | { kind: "reasoning_done"; text: string }
  | { kind: "image_generated"; attachment: AttachmentView }
  | { kind: "message_completed"; message: MessageView; usage?: UsageView }
  | { kind: "error"; message: string };

export type UsageView = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type SendMessageResponse = {
  conversationId: string;
  userNodeId: string;
  assistantNodeId: string;
  runId: string;
};

export const defaultCapabilities: ModelCapabilities = {
  text: true,
  imageInput: false,
  fileInput: false,
  webSearch: false,
  reasoning: false,
  reasoningSummary: false,
  imageGeneration: false
};

export const reasoningEffortLabels: Record<ReasoningEffort, string> = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高"
};
