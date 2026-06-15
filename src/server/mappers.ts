import type {
  AttachmentView,
  ConversationDetail,
  ConversationNodeView,
  ConversationSummary,
  MessageView,
  PublicModel,
  PublicProvider,
  PublicUser
} from "../shared/types.js";
import { parseJson } from "./utils/json.js";
import type {
  AttachmentRow,
  ConversationRow,
  MessageRow,
  ModelRow,
  NodeRow,
  ProviderRow,
  UserRow
} from "./db/schema.js";

export function publicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt
  };
}

export function publicProvider(row: ProviderRow): PublicProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasApiKey: Boolean(row.encryptedApiKey)
  };
}

export function publicModel(row: ModelRow, providerName: string): PublicModel {
  return {
    id: row.id,
    providerId: row.providerId,
    providerName,
    upstreamId: row.upstreamId,
    displayName: row.displayName,
    type: row.type,
    capabilities: parseJson(row.capabilities, row.capabilities),
    defaultSystemPrompt: row.defaultSystemPrompt,
    defaultReasoningEffort: row.defaultReasoningEffort,
    defaultWebSearch: row.defaultWebSearch,
    defaultParams: parseJson(row.defaultParams, {}),
    extraParams: parseJson(row.extraParams, {}),
    hardParams: parseJson(row.hardParams, {}),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function conversationSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    currentLeafNodeId: row.currentLeafNodeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function nodeView(row: NodeRow): ConversationNodeView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    parentId: row.parentId,
    role: row.role as ConversationNodeView["role"],
    messageId: row.messageId,
    runId: row.runId,
    branchIndex: row.branchIndex,
    createdAt: row.createdAt
  };
}

export function messageView(row: MessageRow): MessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    nodeId: row.nodeId,
    role: row.role as MessageView["role"],
    parts: parseJson(row.parts, []),
    contentText: row.contentText,
    modelId: row.modelId,
    runId: row.runId,
    upstreamResponseId: row.upstreamResponseId,
    reasoningSummary: row.reasoningSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function attachmentView(row: AttachmentRow): AttachmentView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    url: `/api/attachments/${row.id}`,
    createdAt: row.createdAt
  };
}

export function detailView(
  conversation: ConversationRow,
  nodes: NodeRow[],
  messages: MessageRow[],
  activePath: NodeRow[]
): ConversationDetail {
  return {
    ...conversationSummary(conversation),
    nodes: nodes.map(nodeView),
    messages: messages.map(messageView),
    activePath: activePath.map(nodeView)
  };
}
