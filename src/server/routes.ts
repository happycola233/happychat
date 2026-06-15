import { createReadStream } from "node:fs";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ok } from "../shared/http.js";
import {
  createConversationSchema,
  editMessageSchema,
  inviteInputSchema,
  loginSchema,
  modelPatchSchema,
  preferencesSchema,
  providerInputSchema,
  providerPatchSchema,
  registerSchema,
  sendMessageSchema
} from "../shared/schemas.js";
import type { AppVariables } from "./auth.js";
import {
  authenticate,
  createSession,
  getCurrentUser,
  logoutCurrent,
  registerUser,
  requireAdmin,
  requireAuth,
  setSessionCookie,
  userCount
} from "./auth.js";
import { db } from "./db/index.js";
import {
  attachments,
  conversationNodes,
  conversations,
  errorLogs,
  inviteCodes,
  messages,
  models,
  providers,
  runs,
  usageLogs,
  userPreferences,
  users
} from "./db/schema.js";
import { badRequest, forbidden, jsonError, notFound } from "./errors.js";
import { OpenAICompatibleClient } from "./provider-client.js";
import {
  buildActivePath,
  compactTitle,
  loadConversationForUser,
  loadConversationGraph,
  nextBranchIndex
} from "./conversation-service.js";
import { attachmentForUser, saveUpload } from "./attachment-service.js";
import { detailView, publicModel, publicProvider, publicUser } from "./mappers.js";
import { inferModelConfig, normalizeBaseUrl } from "./model-config.js";
import { decryptSecret, encryptSecret } from "./utils/crypto.js";
import { newId, nowIso } from "./utils/ids.js";
import { cancelRun, loadRunEvents, startRun, subscribeRun } from "./run-manager.js";
import type { MessagePart } from "../shared/types.js";

type AppEnv = { Variables: AppVariables };

export const api = new Hono<AppEnv>();

api.onError((error, c) => jsonError(c, error));

api.get("/health", (c) => c.json(ok({ status: "ok", time: nowIso() })));

api.get("/setup/status", async (c) => {
  const count = await userCount();
  return c.json(ok({ hasUsers: count > 0 }));
});

api.post("/auth/register", async (c) => {
  const input = parseJsonBody(registerSchema, await c.req.json());
  const user = await registerUser(input);
  const sessionId = await createSession(user.id);
  setSessionCookie(c, sessionId);
  return c.json(ok({ user }));
});

api.post("/auth/login", async (c) => {
  const input = parseJsonBody(loginSchema, await c.req.json());
  const user = await authenticate(input.email, input.password);
  const sessionId = await createSession(user.id);
  setSessionCookie(c, sessionId);
  return c.json(ok({ user }));
});

api.post("/auth/logout", async (c) => {
  await logoutCurrent(c);
  return c.json(ok({ done: true }));
});

api.get("/me", async (c) => {
  const user = await getCurrentUser(c);
  return c.json(ok({ user }));
});

api.get("/preferences", requireAuth, async (c) => {
  const user = c.get("user");
  await db.insert(userPreferences).values({ userId: user.id }).onConflictDoNothing();
  const pref = (
    await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1)
  )[0];
  return c.json(
    ok({
      currentModelId: pref.currentModelId,
      webSearchEnabled: pref.webSearchEnabled,
      reasoningEffort: pref.reasoningEffort,
      imageOptions: pref.imageOptions
    })
  );
});

api.put("/preferences", requireAuth, async (c) => {
  const user = c.get("user");
  const input = parseJsonBody(preferencesSchema, await c.req.json());
  await db
    .insert(userPreferences)
    .values({
      userId: user.id,
      currentModelId: input.currentModelId ?? null,
      webSearchEnabled: input.webSearchEnabled ?? false,
      reasoningEffort: input.reasoningEffort ?? "medium",
      imageOptions: input.imageOptions ?? {},
      updatedAt: nowIso()
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        ...("currentModelId" in input ? { currentModelId: input.currentModelId ?? null } : {}),
        ...("webSearchEnabled" in input
          ? { webSearchEnabled: input.webSearchEnabled ?? false }
          : {}),
        ...("reasoningEffort" in input
          ? { reasoningEffort: input.reasoningEffort ?? "medium" }
          : {}),
        ...("imageOptions" in input ? { imageOptions: input.imageOptions ?? {} } : {}),
        updatedAt: nowIso()
      }
    });
  return c.json(ok({ done: true }));
});

api.get("/models", requireAuth, async (c) => {
  const rows = await db
    .select({ model: models, provider: providers })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(and(eq(models.enabled, true), eq(providers.enabled, true)))
    .orderBy(models.displayName);
  return c.json(ok(rows.map((row) => publicModel(row.model, row.provider.name))));
});

api.post("/attachments", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const file = body.file;
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  if (!(file instanceof File)) badRequest("请选择要上传的文件");
  const attachment = await saveUpload({ userId: user.id, file, conversationId });
  return c.json(ok(attachment));
});

api.get("/attachments/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const row = await attachmentForUser(c.req.param("id"), user.id, user.role === "admin");
  return new Response(createReadStream(row.storagePath) as unknown as BodyInit, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.originalName)}`
    }
  });
});

api.get("/conversations", requireAuth, async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, user.id), eq(conversations.archived, false)))
    .orderBy(desc(conversations.updatedAt));
  return c.json(
    ok(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        currentLeafNodeId: row.currentLeafNodeId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    )
  );
});

api.post("/conversations", requireAuth, async (c) => {
  const user = c.get("user");
  const input = parseJsonBody(createConversationSchema, await c.req.json().catch(() => ({})));
  const id = newId("conv");
  await db.insert(conversations).values({ id, userId: user.id, title: input.title || "新的对话" });
  return c.json(ok({ id }));
});

api.get("/conversations/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const conversation = await loadConversationForUser(
    c.req.param("id"),
    user.id,
    user.role === "admin"
  );
  const graph = await loadConversationGraph(conversation.id);
  const activePath = buildActivePath(graph.nodes, conversation.currentLeafNodeId);
  return c.json(ok(detailView(conversation, graph.nodes, graph.messages, activePath)));
});

api.patch("/conversations/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const body = (await c.req.json()) as { title?: string };
  const conversation = await loadConversationForUser(
    c.req.param("id"),
    user.id,
    user.role === "admin"
  );
  await db
    .update(conversations)
    .set({ title: String(body.title ?? conversation.title).slice(0, 120), updatedAt: nowIso() })
    .where(eq(conversations.id, conversation.id));
  return c.json(ok({ done: true }));
});

api.post("/conversations/:id/switch", requireAuth, async (c) => {
  const user = c.get("user");
  const conversation = await loadConversationForUser(
    c.req.param("id"),
    user.id,
    user.role === "admin"
  );
  const body = (await c.req.json()) as { nodeId?: string };
  if (!body.nodeId) badRequest("请选择要切换的分支");
  const graph = await loadConversationGraph(conversation.id);
  const target = graph.nodes.find((node) => node.id === body.nodeId);
  if (!target) notFound("分支不存在");
  const leaf = deepestLeaf(graph.nodes, target.id);
  await db
    .update(conversations)
    .set({ currentLeafNodeId: leaf, updatedAt: nowIso() })
    .where(eq(conversations.id, conversation.id));
  return c.json(ok({ currentLeafNodeId: leaf }));
});

api.delete("/conversations/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const conversation = await loadConversationForUser(
    c.req.param("id"),
    user.id,
    user.role === "admin"
  );
  await db
    .update(conversations)
    .set({ archived: true, updatedAt: nowIso() })
    .where(eq(conversations.id, conversation.id));
  return c.json(ok({ done: true }));
});

api.post("/conversations/:id/send", requireAuth, async (c) => {
  const user = c.get("user");
  const conversation = await loadConversationForUser(c.req.param("id"), user.id, false);
  const input = parseJsonBody(sendMessageSchema, await c.req.json());
  const response = await createRunForUserMessage({
    conversationId: conversation.id,
    userId: user.id,
    parentNodeId: input.parentNodeId ?? conversation.currentLeafNodeId,
    content: input.content,
    modelId: input.modelId,
    attachmentIds: input.attachmentIds,
    options: input.options
  });
  if (conversation.title === "新的对话" && input.content.trim()) {
    await db
      .update(conversations)
      .set({ title: compactTitle(input.content), updatedAt: nowIso() })
      .where(eq(conversations.id, conversation.id));
  }
  return c.json(ok(response));
});

api.post("/conversations/:id/edit", requireAuth, async (c) => {
  const user = c.get("user");
  const conversation = await loadConversationForUser(c.req.param("id"), user.id, false);
  const input = parseJsonBody(editMessageSchema, await c.req.json());
  const target = (
    await db
      .select()
      .from(conversationNodes)
      .where(
        and(
          eq(conversationNodes.id, input.targetNodeId),
          eq(conversationNodes.conversationId, conversation.id)
        )
      )
      .limit(1)
  )[0];
  if (!target || target.role !== "user") badRequest("只能编辑用户消息");
  const response = await createRunForUserMessage({
    conversationId: conversation.id,
    userId: user.id,
    parentNodeId: target.parentId,
    content: input.content,
    modelId: input.modelId,
    attachmentIds: input.attachmentIds,
    options: input.options
  });
  return c.json(ok(response));
});

api.post("/runs/:id/cancel", requireAuth, async (c) => {
  const user = c.get("user");
  const run = await runForUser(c.req.param("id"), user.id, user.role === "admin");
  await cancelRun(run.id);
  return c.json(ok({ done: true }));
});

api.get("/runs/:id/events", requireAuth, async (c) => {
  const user = c.get("user");
  const run = await runForUser(c.req.param("id"), user.id, user.role === "admin");
  const headerLast = Number(c.req.header("Last-Event-ID") ?? 0);
  const queryLast = Number(c.req.query("after") ?? 0);
  const afterId =
    Number.isFinite(queryLast) && queryLast > 0
      ? queryLast
      : Number.isFinite(headerLast)
        ? headerLast
        : 0;
  return streamSSE(c, async (stream) => {
    for (const event of await loadRunEvents(run.id, afterId)) {
      await stream.writeSSE({
        id: String(event.id),
        event: event.type,
        data: JSON.stringify(event.data)
      });
    }
    const unsubscribe = subscribeRun(run.id, (event) => {
      void stream.writeSSE({
        id: String(event.id),
        event: event.type,
        data: JSON.stringify(event.data)
      });
    });
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        unsubscribe();
        resolve();
      });
    });
  });
});

api.get("/admin/users", requireAdmin, async (c) => {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  return c.json(ok(rows.map(publicUser)));
});

api.patch("/admin/users/:id", requireAdmin, async (c) => {
  const body = (await c.req.json()) as {
    role?: "admin" | "user";
    status?: "active" | "disabled";
    name?: string;
  };
  await db
    .update(users)
    .set({
      ...(body.role ? { role: body.role } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.name ? { name: body.name } : {}),
      updatedAt: nowIso()
    })
    .where(eq(users.id, c.req.param("id")));
  return c.json(ok({ done: true }));
});

api.get("/admin/invites", requireAdmin, async (c) => {
  const rows = await db.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt));
  return c.json(ok(rows));
});

api.post("/admin/invites", requireAdmin, async (c) => {
  const user = c.get("user");
  const input = parseJsonBody(inviteInputSchema, await c.req.json().catch(() => ({})));
  const code = newId("invite");
  await db.insert(inviteCodes).values({
    code,
    createdBy: user.id,
    maxUses: input.maxUses,
    expiresAt: input.expiresAt ?? null
  });
  return c.json(ok({ code }));
});

api.patch("/admin/invites/:code", requireAdmin, async (c) => {
  const body = (await c.req.json()) as { disabled?: boolean };
  await db
    .update(inviteCodes)
    .set({ disabled: body.disabled ?? false })
    .where(eq(inviteCodes.code, c.req.param("code")));
  return c.json(ok({ done: true }));
});

api.get("/admin/providers", requireAdmin, async (c) => {
  const rows = await db.select().from(providers).orderBy(desc(providers.createdAt));
  return c.json(ok(rows.map(publicProvider)));
});

api.post("/admin/providers", requireAdmin, async (c) => {
  const input = parseJsonBody(providerInputSchema, await c.req.json());
  const id = newId("prov");
  await db.insert(providers).values({
    id,
    name: input.name,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    encryptedApiKey: encryptSecret(input.apiKey),
    enabled: input.enabled
  });
  return c.json(ok({ id }));
});

api.patch("/admin/providers/:id", requireAdmin, async (c) => {
  const input = parseJsonBody(providerPatchSchema, await c.req.json());
  await db
    .update(providers)
    .set({
      ...(input.name ? { name: input.name } : {}),
      ...(input.baseUrl ? { baseUrl: normalizeBaseUrl(input.baseUrl) } : {}),
      ...(input.apiKey ? { encryptedApiKey: encryptSecret(input.apiKey) } : {}),
      ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
      updatedAt: nowIso()
    })
    .where(eq(providers.id, c.req.param("id")));
  return c.json(ok({ done: true }));
});

api.delete("/admin/providers/:id", requireAdmin, async (c) => {
  await db.delete(providers).where(eq(providers.id, c.req.param("id")));
  return c.json(ok({ done: true }));
});

api.post("/admin/providers/:id/verify", requireAdmin, async (c) => {
  const provider = await providerById(c.req.param("id"));
  const client = new OpenAICompatibleClient(
    provider.baseUrl,
    decryptSecret(provider.encryptedApiKey)
  );
  const list = await client.listModels();
  return c.json(ok({ count: list.length, models: list.slice(0, 20) }));
});

api.get("/admin/providers/:id/models", requireAdmin, async (c) => {
  const provider = await providerById(c.req.param("id"));
  const client = new OpenAICompatibleClient(
    provider.baseUrl,
    decryptSecret(provider.encryptedApiKey)
  );
  const list = await client.listModels();
  return c.json(ok(list));
});

api.post("/admin/providers/:id/models/import", requireAdmin, async (c) => {
  const provider = await providerById(c.req.param("id"));
  const body = (await c.req.json()) as { modelIds?: string[] };
  const client = new OpenAICompatibleClient(
    provider.baseUrl,
    decryptSecret(provider.encryptedApiKey)
  );
  const upstream = await client.listModels();
  const selected = body.modelIds?.length
    ? upstream.filter((model) => body.modelIds?.includes(model.id))
    : upstream;
  for (const item of selected) {
    const inferred = inferModelConfig(item.id);
    await db
      .insert(models)
      .values({
        id: newId("mdl"),
        providerId: provider.id,
        upstreamId: item.id,
        displayName: inferred.displayName,
        type: inferred.type,
        capabilities: inferred.capabilities,
        defaultReasoningEffort: inferred.defaultReasoningEffort,
        hardParams: inferred.hardParams
      })
      .onConflictDoNothing();
  }
  return c.json(ok({ imported: selected.length }));
});

api.get("/admin/models", requireAdmin, async (c) => {
  const rows = await db
    .select({ model: models, provider: providers })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id));
  return c.json(ok(rows.map((row) => publicModel(row.model, row.provider.name))));
});

api.patch("/admin/models/:id", requireAdmin, async (c) => {
  const input = parseJsonBody(modelPatchSchema, await c.req.json());
  await db
    .update(models)
    .set({
      ...input,
      updatedAt: nowIso()
    })
    .where(eq(models.id, c.req.param("id")));
  return c.json(ok({ done: true }));
});

api.get("/admin/stats/overview", requireAdmin, async (c) => {
  const userTotal = (await db.select({ value: count() }).from(users))[0]?.value ?? 0;
  const convoTotal = (await db.select({ value: count() }).from(conversations))[0]?.value ?? 0;
  const runTotal = (await db.select({ value: count() }).from(runs))[0]?.value ?? 0;
  const usage = (
    await db
      .select({
        inputTokens: sql<number>`coalesce(sum(${usageLogs.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${usageLogs.outputTokens}), 0)`,
        cachedInputTokens: sql<number>`coalesce(sum(${usageLogs.cachedInputTokens}), 0)`
      })
      .from(usageLogs)
  )[0];
  return c.json(ok({ userTotal, convoTotal, runTotal, usage }));
});

api.get("/admin/stats/usage", requireAdmin, async (c) => {
  const rows = await db
    .select({ usage: usageLogs, user: users, model: models, provider: providers })
    .from(usageLogs)
    .leftJoin(users, eq(usageLogs.userId, users.id))
    .leftJoin(models, eq(usageLogs.modelId, models.id))
    .leftJoin(providers, eq(usageLogs.providerId, providers.id))
    .orderBy(desc(usageLogs.createdAt))
    .limit(200);
  return c.json(ok(rows));
});

api.get("/admin/errors", requireAdmin, async (c) => {
  const rows = await db.select().from(errorLogs).orderBy(desc(errorLogs.createdAt)).limit(200);
  return c.json(ok(rows));
});

async function createRunForUserMessage(input: {
  conversationId: string;
  userId: string;
  parentNodeId: string | null;
  content: string;
  modelId: string;
  attachmentIds: string[];
  options: unknown;
}) {
  const model = (
    await db
      .select()
      .from(models)
      .where(and(eq(models.id, input.modelId), eq(models.enabled, true)))
      .limit(1)
  )[0];
  if (!model) badRequest("模型不可用");
  const provider = (
    await db
      .select()
      .from(providers)
      .where(and(eq(providers.id, model.providerId), eq(providers.enabled, true)))
      .limit(1)
  )[0];
  if (!provider) badRequest("Provider 不可用");

  const attachmentRows = input.attachmentIds.length
    ? await db.select().from(attachments).where(inArray(attachments.id, input.attachmentIds))
    : [];
  if (attachmentRows.some((row) => row.userId !== input.userId)) forbidden("附件无权访问");

  const userNodeId = newId("node");
  const userMessageId = newId("msg");
  const assistantNodeId = newId("node");
  const assistantMessageId = newId("msg");
  const runId = newId("run");
  const userParts: MessagePart[] = [
    ...(input.content.trim() ? [{ type: "text" as const, text: input.content }] : []),
    ...attachmentRows.map(
      (row): MessagePart =>
        row.kind === "image"
          ? {
              type: "image",
              attachmentId: row.id,
              url: `/api/attachments/${row.id}`,
              mimeType: row.mimeType,
              name: row.originalName
            }
          : { type: "file", attachmentId: row.id, mimeType: row.mimeType, name: row.originalName }
    )
  ];

  const userBranch = await nextBranchIndex(input.conversationId, input.parentNodeId);

  db.transaction((tx) => {
    tx.insert(messages)
      .values({
        id: userMessageId,
        conversationId: input.conversationId,
        nodeId: userNodeId,
        role: "user",
        parts: userParts,
        contentText: input.content
      })
      .run();
    tx.insert(conversationNodes)
      .values({
        id: userNodeId,
        conversationId: input.conversationId,
        parentId: input.parentNodeId,
        role: "user",
        messageId: userMessageId,
        branchIndex: userBranch
      })
      .run();
    tx.insert(messages)
      .values({
        id: assistantMessageId,
        conversationId: input.conversationId,
        nodeId: assistantNodeId,
        role: "assistant",
        parts: [],
        contentText: "",
        modelId: model.id,
        runId
      })
      .run();
    tx.insert(conversationNodes)
      .values({
        id: assistantNodeId,
        conversationId: input.conversationId,
        parentId: userNodeId,
        role: "assistant",
        messageId: assistantMessageId,
        runId,
        branchIndex: 0
      })
      .run();
    tx.update(attachments)
      .set({ conversationId: input.conversationId, messageId: userMessageId })
      .where(
        inArray(attachments.id, input.attachmentIds.length ? input.attachmentIds : ["__none__"])
      )
      .run();
    tx.insert(runs)
      .values({
        id: runId,
        userId: input.userId,
        conversationId: input.conversationId,
        modelId: model.id,
        providerId: provider.id,
        userNodeId,
        assistantNodeId,
        inputSnapshot: { options: input.options ?? {} }
      })
      .run();
    tx.update(conversations)
      .set({ currentLeafNodeId: assistantNodeId, updatedAt: nowIso() })
      .where(eq(conversations.id, input.conversationId))
      .run();
  });

  startRun(runId);
  return { conversationId: input.conversationId, userNodeId, assistantNodeId, runId };
}

async function runForUser(runId: string, userId: string, isAdmin: boolean) {
  const where = isAdmin ? eq(runs.id, runId) : and(eq(runs.id, runId), eq(runs.userId, userId));
  const row = (await db.select().from(runs).where(where).limit(1))[0];
  if (!row) notFound("任务不存在");
  return row;
}

async function providerById(id: string) {
  const row = (await db.select().from(providers).where(eq(providers.id, id)).limit(1))[0];
  if (!row) notFound("Provider 不存在");
  return row;
}

function parseJsonBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "请求参数不正确";
    badRequest(message);
  }
  return parsed.data;
}

function deepestLeaf(
  nodes: Array<{ id: string; parentId: string | null; createdAt: string }>,
  startId: string
): string {
  let current = startId;
  while (true) {
    const children = nodes
      .filter((node) => node.parentId === current)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (children.length === 0) return current;
    current = children[children.length - 1].id;
  }
}
