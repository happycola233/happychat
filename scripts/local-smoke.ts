import type { ApiResult } from "../src/shared/http.js";
import type {
  ConversationDetail,
  PublicModel,
  PublicProvider,
  PublicUser,
  RunEventPayload,
  SendMessageResponse
} from "../src/shared/types.js";

type Session = {
  cookie: string;
};

const apiBase = process.env.LOCAL_SMOKE_API_BASE ?? "http://127.0.0.1:8787/api";
const providerBaseUrl =
  process.env.LOCAL_SMOKE_PROVIDER_BASE_URL ?? "https://api.example.com/v1";
const providerApiKey = process.env.LOCAL_SMOKE_PROVIDER_KEY;
const email = process.env.LOCAL_SMOKE_EMAIL ?? "smoke-admin@happychat.local";
const password = process.env.LOCAL_SMOKE_PASSWORD ?? "SmokePass123!";

if (!providerApiKey) {
  console.error("缺少 LOCAL_SMOKE_PROVIDER_KEY。请只在当前命令环境中传入。");
  process.exit(1);
}

const session: Session = { cookie: "" };

const setup = await apiGet<{ hasUsers: boolean }>("/setup/status");
let user: PublicUser;
if (!setup.hasUsers) {
  user = (
    await apiPost<{ user: PublicUser }>("/auth/register", { email, password, name: "冒烟管理员" })
  ).user;
} else {
  try {
    user = (await apiPost<{ user: PublicUser }>("/auth/login", { email, password })).user;
  } catch {
    throw new Error(
      "已有用户库，但默认冒烟管理员无法登录。请清理 data/ 或设置 LOCAL_SMOKE_EMAIL/LOCAL_SMOKE_PASSWORD。"
    );
  }
}

if (user.role !== "admin") throw new Error("冒烟用户不是管理员");
console.log(`已登录管理员：${user.email}`);

const provider = await ensureProvider();
console.log(`Provider 可用：${provider.name}`);

const verify = await apiPost<{ count: number }>(`/admin/providers/${provider.id}/verify`);
console.log(`上游模型数量：${verify.count}`);

const upstream = await apiGet<Array<{ id: string }>>(`/admin/providers/${provider.id}/models`);
const modelIds = upstream
  .map((item) => item.id)
  .filter((id) => id !== "gpt-5.3-codex-spark" && id !== "codex-auto-review");
await apiPost<{ imported: number }>(`/admin/providers/${provider.id}/models/import`, { modelIds });

const models = await apiGet<PublicModel[]>("/models");
const chatModel =
  models.find((model) => model.upstreamId === "gpt-5.4-mini") ??
  models.find((model) => model.type === "chat");
if (!chatModel) throw new Error("未找到可用于聊天的模型");
console.log(`选用聊天模型：${chatModel.displayName}`);

await apiPut<{ done: boolean }>("/preferences", {
  currentModelId: chatModel.id,
  webSearchEnabled: false,
  reasoningEffort: chatModel.capabilities.reasoning ? "low" : "none"
});

const conversation = await apiPost<{ id: string }>("/conversations", { title: "本地冒烟会话" });
const first = await apiPost<SendMessageResponse>(`/conversations/${conversation.id}/send`, {
  content: "请用一句中文回复：本地流式冒烟测试通过。",
  modelId: chatModel.id,
  attachmentIds: [],
  options: { reasoningEffort: chatModel.capabilities.reasoning ? "low" : "none" }
});
const firstEvents = await waitForRun(first.runId);
if (!firstEvents.text.trim()) throw new Error("首次生成没有流式文本");
console.log(`首次流式输出 ${firstEvents.text.length} 字`);

const replay = await waitForRun(first.runId, 0);
if (!replay.completed) throw new Error("run_events 历史回放未拿到完成事件");
console.log("run_events 历史回放通过");

const edited = await apiPost<SendMessageResponse>(`/conversations/${conversation.id}/edit`, {
  targetNodeId: first.userNodeId,
  content: "请用一句不同的中文回复：编辑分支冒烟测试通过。",
  modelId: chatModel.id,
  attachmentIds: [],
  options: { reasoningEffort: chatModel.capabilities.reasoning ? "low" : "none" }
});
const editEvents = await waitForRun(edited.runId);
if (!editEvents.text.trim()) throw new Error("编辑分支生成没有流式文本");

const detail = await apiGet<ConversationDetail>(`/conversations/${conversation.id}`);
const rootUserBranches = detail.nodes.filter(
  (node) => node.parentId === null && node.role === "user"
);
if (rootUserBranches.length < 2) throw new Error("编辑消息没有创建新的用户分支");
console.log(`编辑分支通过：根用户分支 ${rootUserBranches.length} 条`);

const stats = await apiGet<{
  userTotal: number;
  convoTotal: number;
  runTotal: number;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}>("/admin/stats/overview");
if (stats.runTotal < 2) throw new Error("后台统计没有记录模型调用");
await apiGet<unknown[]>("/admin/errors");
console.log(
  `后台统计通过：runs=${stats.runTotal}, input=${stats.usage.inputTokens}, output=${stats.usage.outputTokens}`
);

async function ensureProvider(): Promise<PublicProvider> {
  const providers = await apiGet<PublicProvider[]>("/admin/providers");
  const existing = providers.find(
    (item) => item.baseUrl.replace(/\/+$/, "") === providerBaseUrl.replace(/\/+$/, "")
  );
  if (existing) {
    await apiPatch<{ done: boolean }>(`/admin/providers/${existing.id}`, {
      apiKey: providerApiKey,
      enabled: true
    });
    return existing;
  }
  const created = await apiPost<{ id: string }>("/admin/providers", {
    name: "HappyCola",
    baseUrl: providerBaseUrl,
    apiKey: providerApiKey,
    enabled: true
  });
  return (
    (await apiGet<PublicProvider[]>("/admin/providers")).find((item) => item.id === created.id) ??
    (await apiGet<PublicProvider[]>("/admin/providers"))[0]!
  );
}

async function waitForRun(
  runId: string,
  after?: number
): Promise<{
  text: string;
  completed: boolean;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  const response = await fetch(
    `${apiBase}/runs/${runId}/events${after == null ? "" : `?after=${after}`}`,
    {
      headers: { Cookie: session.cookie },
      signal: controller.signal
    }
  );
  if (!response.ok || !response.body) throw new Error(`无法连接 SSE：HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completed = false;
  try {
    while (!completed) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseLocalSse(raw);
        if (event) {
          if (event.kind === "text_delta") text += event.delta;
          if (event.kind === "error") throw new Error(event.message);
          if (event.kind === "message_completed") completed = true;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  return { text, completed };
}

function parseLocalSse(raw: string): RunEventPayload | null {
  const data = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? (JSON.parse(data) as RunEventPayload) : null;
}

async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, "POST", body);
}

async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, "PUT", body);
}

async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, "PATCH", body);
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(body == null ? {} : { "Content-Type": "application/json" }),
      ...(session.cookie ? { Cookie: session.cookie } : {})
    },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) session.cookie = setCookie.split(";")[0] ?? session.cookie;
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result?.ok) {
    throw new Error(
      result?.ok === false
        ? result.error.message
        : `请求失败：${method} ${path} HTTP ${response.status}`
    );
  }
  return result.data;
}
