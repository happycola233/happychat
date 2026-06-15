import type {
  AttachmentView,
  ChatOptions,
  ConversationDetail,
  ConversationSummary,
  PublicModel,
  PublicProvider,
  PublicUser,
  ReasoningEffort,
  RunEventPayload,
  SendMessageResponse
} from "../shared/types.js";
import type { ApiResult } from "../shared/http.js";
import type { LoginInput, PreferencesInput, RegisterInput } from "../shared/schemas.js";

export type InviteRow = {
  code: string;
  maxUses: number;
  uses: number;
  disabled: boolean;
  expiresAt: string | null;
  createdAt: string;
};

export type OverviewStats = {
  userTotal: number;
  convoTotal: number;
  runTotal: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  };
};

export type ErrorLogRow = {
  id: number;
  source: string;
  message: string;
  detail: string | null;
  createdAt: string;
};

export type Preferences = {
  currentModelId: string | null;
  webSearchEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  imageOptions: Record<string, unknown>;
};

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body)
  });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body)
  });
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body)
  });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE" });
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "include", ...init });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result?.ok) {
    throw new Error(result?.ok === false ? result.error.message : "请求失败，请稍后再试");
  }
  return result.data;
}

export const api = {
  setupStatus: () => apiGet<{ hasUsers: boolean }>("/setup/status"),
  me: () => apiGet<{ user: PublicUser | null }>("/me"),
  login: (input: LoginInput) => apiPost<{ user: PublicUser }>("/auth/login", input),
  register: (input: RegisterInput) => apiPost<{ user: PublicUser }>("/auth/register", input),
  logout: () => apiPost<{ done: boolean }>("/auth/logout"),
  models: () => apiGet<PublicModel[]>("/models"),
  preferences: () => apiGet<Preferences>("/preferences"),
  savePreferences: (input: PreferencesInput) => apiPut<{ done: boolean }>("/preferences", input),
  conversations: () => apiGet<ConversationSummary[]>("/conversations"),
  createConversation: (title?: string) => apiPost<{ id: string }>("/conversations", { title }),
  conversation: (id: string) => apiGet<ConversationDetail>(`/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    apiPatch<{ done: boolean }>(`/conversations/${id}`, { title }),
  deleteConversation: (id: string) => apiDelete<{ done: boolean }>(`/conversations/${id}`),
  switchBranch: (id: string, nodeId: string) =>
    apiPost<{ currentLeafNodeId: string }>(`/conversations/${id}/switch`, { nodeId }),
  sendMessage: (
    conversationId: string,
    input: {
      content: string;
      modelId: string;
      parentNodeId?: string | null;
      attachmentIds: string[];
      options: ChatOptions;
    }
  ) => apiPost<SendMessageResponse>(`/conversations/${conversationId}/send`, input),
  editMessage: (
    conversationId: string,
    input: {
      targetNodeId: string;
      content: string;
      modelId: string;
      attachmentIds: string[];
      options: ChatOptions;
    }
  ) => apiPost<SendMessageResponse>(`/conversations/${conversationId}/edit`, input),
  cancelRun: (runId: string) => apiPost<{ done: boolean }>(`/runs/${runId}/cancel`),
  uploadAttachment: async (file: File, conversationId?: string | null): Promise<AttachmentView> => {
    const form = new FormData();
    form.append("file", file);
    if (conversationId) form.append("conversationId", conversationId);
    const response = await fetch("/api/attachments", {
      method: "POST",
      body: form,
      credentials: "include"
    });
    const result = (await response.json()) as ApiResult<AttachmentView>;
    if (!response.ok || !result.ok)
      throw new Error(result.ok === false ? result.error.message : "上传失败");
    return result.data;
  },
  admin: {
    users: () => apiGet<PublicUser[]>("/admin/users"),
    updateUser: (id: string, body: Partial<Pick<PublicUser, "role" | "status" | "name">>) =>
      apiPatch<{ done: boolean }>(`/admin/users/${id}`, body),
    invites: () => apiGet<InviteRow[]>("/admin/invites"),
    createInvite: (maxUses = 1) => apiPost<{ code: string }>("/admin/invites", { maxUses }),
    toggleInvite: (code: string, disabled: boolean) =>
      apiPatch<{ done: boolean }>(`/admin/invites/${code}`, { disabled }),
    providers: () => apiGet<PublicProvider[]>("/admin/providers"),
    createProvider: (body: { name: string; baseUrl: string; apiKey: string; enabled: boolean }) =>
      apiPost<{ id: string }>("/admin/providers", body),
    updateProvider: (
      id: string,
      body: Partial<{ name: string; baseUrl: string; apiKey: string; enabled: boolean }>
    ) => apiPatch<{ done: boolean }>(`/admin/providers/${id}`, body),
    deleteProvider: (id: string) => apiDelete<{ done: boolean }>(`/admin/providers/${id}`),
    verifyProvider: (id: string) =>
      apiPost<{ count: number; models: Array<{ id: string }> }>(`/admin/providers/${id}/verify`),
    upstreamModels: (id: string) => apiGet<Array<{ id: string }>>(`/admin/providers/${id}/models`),
    importModels: (id: string, modelIds?: string[]) =>
      apiPost<{ imported: number }>(`/admin/providers/${id}/models/import`, { modelIds }),
    models: () => apiGet<PublicModel[]>("/admin/models"),
    updateModel: (id: string, body: Partial<PublicModel>) =>
      apiPatch<{ done: boolean }>(`/admin/models/${id}`, body),
    overview: () => apiGet<OverviewStats>("/admin/stats/overview"),
    usage: () => apiGet<unknown[]>("/admin/stats/usage"),
    errors: () => apiGet<ErrorLogRow[]>("/admin/errors")
  }
};

export function openRunEvents(
  runId: string,
  onEvent: (payload: RunEventPayload, id: string) => void
): EventSource {
  const source = new EventSource(`/api/runs/${runId}/events`, { withCredentials: true });
  const names = [
    "status",
    "text_delta",
    "reasoning_delta",
    "reasoning_done",
    "image_generated",
    "message_completed",
    "error"
  ];
  for (const name of names) {
    source.addEventListener(name, (event) => {
      const message = event as MessageEvent<string>;
      onEvent(JSON.parse(message.data) as RunEventPayload, message.lastEventId);
    });
  }
  return source;
}
