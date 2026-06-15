import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  attachments,
  errorLogs,
  messages,
  models,
  providers,
  runEvents,
  runs,
  usageLogs,
  type AttachmentRow,
  type MessageRow,
  type ModelRow,
  type ProviderRow,
  type RunRow
} from "./db/schema.js";
import { messagePathForLeaf } from "./conversation-service.js";
import { OpenAICompatibleClient } from "./provider-client.js";
import { decryptSecret, redactSecrets, safeErrorMessage } from "./utils/crypto.js";
import { deepMerge, parseJson } from "./utils/json.js";
import { nowIso } from "./utils/ids.js";
import { messageView } from "./mappers.js";
import { saveGeneratedImage } from "./attachment-service.js";
import { parseCompletedResponse } from "./responses-parser.js";
import type {
  ChatOptions,
  ImageOptions,
  JsonObject,
  MessagePart,
  RunEventPayload,
  RunStatus,
  UsageView
} from "../shared/types.js";

type Listener = (event: StoredRunEvent) => void;

export type StoredRunEvent = {
  id: number;
  runId: string;
  type: string;
  data: RunEventPayload;
  createdAt: string;
};

const controllers = new Map<string, AbortController>();
const listeners = new Map<string, Set<Listener>>();

export function subscribeRun(runId: string, listener: Listener): () => void {
  const set = listeners.get(runId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(runId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(runId);
  };
}

export async function loadRunEvents(runId: string, afterId = 0): Promise<StoredRunEvent[]> {
  const rows = await db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId)));
  return rows
    .filter((row) => row.id > afterId)
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      runId: row.runId,
      type: row.type,
      data: parseJson(row.data, {}) as RunEventPayload,
      createdAt: row.createdAt
    }));
}

async function emit(
  runId: string,
  type: string,
  data: RunEventPayload,
  upstreamSequence?: number
): Promise<void> {
  const inserted = await db
    .insert(runEvents)
    .values({
      runId,
      type,
      upstreamSequence,
      data: data as unknown as JsonObject
    })
    .returning();
  const row = inserted[0];
  const event: StoredRunEvent = {
    id: row.id,
    runId,
    type,
    data,
    createdAt: row.createdAt
  };
  listeners.get(runId)?.forEach((listener) => listener(event));
}

async function setRunStatus(
  runId: string,
  status: RunStatus,
  patch: Partial<RunRow> = {}
): Promise<void> {
  await db
    .update(runs)
    .set({
      status,
      ...(status === "connecting" ? { startedAt: nowIso() } : {}),
      ...(status === "completed" || status === "failed" || status === "canceled"
        ? { completedAt: nowIso() }
        : {}),
      ...patch
    })
    .where(eq(runs.id, runId));
  await emit(runId, "status", { kind: "status", status });
}

export async function cancelRun(runId: string, reason = "用户已停止生成"): Promise<void> {
  controllers.get(runId)?.abort();
  const run = (await db.select().from(runs).where(eq(runs.id, runId)).limit(1))[0];
  if (run?.upstreamResponseId) {
    const provider = (
      await db.select().from(providers).where(eq(providers.id, run.providerId)).limit(1)
    )[0];
    if (provider) {
      const client = new OpenAICompatibleClient(
        provider.baseUrl,
        decryptSecret(provider.encryptedApiKey)
      );
      client.cancelResponse(run.upstreamResponseId).catch(() => undefined);
    }
  }
  await db
    .update(runs)
    .set({ status: "canceled", abortReason: reason, completedAt: nowIso() })
    .where(eq(runs.id, runId));
  await emit(runId, "status", { kind: "status", status: "canceled", message: reason });
}

export function startRun(runId: string): void {
  void executeRun(runId).catch(async (error) => {
    await failRun(runId, error);
  });
}

async function executeRun(runId: string): Promise<void> {
  const run = (await db.select().from(runs).where(eq(runs.id, runId)).limit(1))[0];
  if (!run) return;
  const model = (await db.select().from(models).where(eq(models.id, run.modelId)).limit(1))[0];
  const provider = (
    await db.select().from(providers).where(eq(providers.id, run.providerId)).limit(1)
  )[0];
  if (!model || !provider) throw new Error("模型或 Provider 不存在");
  const client = new OpenAICompatibleClient(
    provider.baseUrl,
    decryptSecret(provider.encryptedApiKey)
  );
  const controller = new AbortController();
  controllers.set(runId, controller);
  await setRunStatus(runId, "connecting");
  try {
    if (model.type === "image") {
      await executeImageRun(run, model, provider, client, controller.signal);
    } else {
      await executeResponseRun(run, model, provider, client, controller.signal);
    }
  } finally {
    controllers.delete(runId);
  }
}

async function executeImageRun(
  run: RunRow,
  model: ModelRow,
  provider: ProviderRow,
  client: OpenAICompatibleClient,
  signal: AbortSignal
): Promise<void> {
  const path = await messagePathForLeaf(run.conversationId, run.userNodeId);
  const lastUser = path[path.length - 1];
  const options = parseJson(run.inputSnapshot, {}) as { options?: ChatOptions };
  const imageOptions = options.options?.imageOptions ?? {};
  const prompt = lastUser?.contentText || "生成一张图片";
  const payload = imagePayload(model.upstreamId, prompt, imageOptions);
  await db
    .update(runs)
    .set({ status: "streaming", requestPayload: redactSecrets(payload) as JsonObject })
    .where(eq(runs.id, run.id));
  await emit(run.id, "status", { kind: "status", status: "streaming" });
  const result = await client.generateImage(payload, signal);
  const b64 = extractImageBase64(result);
  if (!b64) throw new Error("上游未返回图片数据");
  const assistant = await assistantMessageForRun(run.assistantNodeId);
  const attachment = await saveGeneratedImage({
    userId: run.userId,
    conversationId: run.conversationId,
    messageId: assistant.id,
    runId: run.id,
    base64: b64,
    mimeType:
      imageOptions.format === "jpeg"
        ? "image/jpeg"
        : imageOptions.format === "webp"
          ? "image/webp"
          : "image/png"
  });
  const parts: MessagePart[] = [
    {
      type: "generated_image",
      attachmentId: attachment.id,
      url: attachment.url,
      mimeType: attachment.mimeType,
      name: attachment.name
    }
  ];
  await db
    .update(messages)
    .set({
      parts,
      contentText: "已生成图片",
      updatedAt: nowIso(),
      modelId: model.id,
      runId: run.id
    })
    .where(eq(messages.id, assistant.id));
  await emit(run.id, "image_generated", { kind: "image_generated", attachment });
  const finalMessage = (
    await db.select().from(messages).where(eq(messages.id, assistant.id)).limit(1)
  )[0];
  await emit(run.id, "message_completed", {
    kind: "message_completed",
    message: messageView(finalMessage)
  });
  await db.insert(usageLogs).values({
    runId: run.id,
    userId: run.userId,
    providerId: provider.id,
    modelId: model.id,
    conversationId: run.conversationId,
    success: true
  });
  await setRunStatus(run.id, "completed");
}

async function executeResponseRun(
  run: RunRow,
  model: ModelRow,
  provider: ProviderRow,
  client: OpenAICompatibleClient,
  signal: AbortSignal
): Promise<void> {
  const options = parseJson(run.inputSnapshot, {}) as { options?: ChatOptions };
  const payload = await buildResponsePayload(run, model, options.options ?? {}, provider);
  await db
    .update(runs)
    .set({ requestPayload: redactSecrets(payload) as JsonObject })
    .where(eq(runs.id, run.id));
  await setRunStatus(run.id, "streaming");

  let accumulatedText = "";
  let reasoningText = "";
  let usage: UsageView | undefined;
  const assistant = await assistantMessageForRun(run.assistantNodeId);

  const consume = async (activePayload: JsonObject): Promise<void> => {
    for await (const event of client.streamResponse(activePayload, signal)) {
      const type = String(event.data.type ?? event.event);
      const sequence =
        typeof event.data.sequence_number === "number" ? event.data.sequence_number : undefined;
      if (sequence != null) {
        await db.update(runs).set({ upstreamSequence: sequence }).where(eq(runs.id, run.id));
      }

      if (type === "response.created") {
        const response = event.data.response as JsonObject | undefined;
        const responseId = typeof response?.id === "string" ? response.id : undefined;
        if (responseId)
          await db.update(runs).set({ upstreamResponseId: responseId }).where(eq(runs.id, run.id));
        continue;
      }
      if (type === "response.output_text.delta") {
        const delta = String(event.data.delta ?? "");
        accumulatedText += delta;
        await emit(run.id, "text_delta", { kind: "text_delta", delta }, sequence);
        continue;
      }
      if (
        type === "response.reasoning_summary_text.delta" ||
        type === "response.reasoning_text.delta"
      ) {
        const delta = String(event.data.delta ?? "");
        reasoningText += delta;
        await emit(run.id, "reasoning_delta", { kind: "reasoning_delta", delta }, sequence);
        continue;
      }
      if (type === "response.output_item.done") {
        const item = event.data.item as JsonObject | undefined;
        if (item?.type === "image_generation_call" && typeof item.result === "string") {
          const attachment = await saveGeneratedImage({
            userId: run.userId,
            conversationId: run.conversationId,
            messageId: assistant.id,
            runId: run.id,
            base64: item.result
          });
          await emit(run.id, "image_generated", { kind: "image_generated", attachment }, sequence);
        }
        continue;
      }
      if (type === "response.completed") {
        const response = event.data.response as JsonObject;
        const parsed = parseCompletedResponse(response);
        accumulatedText = parsed.text || accumulatedText;
        reasoningText = parsed.reasoning || reasoningText;
        usage = parsed.usage;
        const parts: MessagePart[] = [];
        if (reasoningText) parts.push({ type: "reasoning", text: reasoningText });
        if (accumulatedText) parts.push({ type: "text", text: accumulatedText });
        await db
          .update(messages)
          .set({
            parts,
            contentText: accumulatedText,
            reasoningSummary: reasoningText || null,
            usage,
            modelId: model.id,
            runId: run.id,
            upstreamResponseId: typeof response.id === "string" ? response.id : null,
            updatedAt: nowIso()
          })
          .where(eq(messages.id, assistant.id));
        await db.insert(usageLogs).values({
          runId: run.id,
          userId: run.userId,
          providerId: provider.id,
          modelId: model.id,
          conversationId: run.conversationId,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cachedInputTokens: usage?.cachedInputTokens ?? 0,
          reasoningTokens: usage?.reasoningTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
          success: true
        });
        const finalMessage = (
          await db.select().from(messages).where(eq(messages.id, assistant.id)).limit(1)
        )[0];
        await emit(
          run.id,
          "message_completed",
          { kind: "message_completed", message: messageView(finalMessage), usage },
          sequence
        );
        await setRunStatus(run.id, "completed");
        return;
      }
      if (type === "response.failed" || type === "error") {
        throw new Error(extractErrorText(event.data));
      }
    }
  };

  try {
    await consume(payload);
  } catch (error) {
    if (!isUnsupportedBackgroundError(error) || payload.background !== true) throw error;
    const fallbackPayload = { ...payload };
    delete fallbackPayload.background;
    await db
      .update(runs)
      .set({ requestPayload: redactSecrets(fallbackPayload) as JsonObject })
      .where(eq(runs.id, run.id));
    await emit(run.id, "status", {
      kind: "status",
      status: "streaming",
      message: "Provider 不支持 background，已改用本地事件续传。"
    });
    await consume(fallbackPayload);
  }
}

async function buildResponsePayload(
  run: RunRow,
  model: ModelRow,
  options: ChatOptions,
  provider: ProviderRow
): Promise<JsonObject> {
  const path = await messagePathForLeaf(run.conversationId, run.userNodeId);
  const previous = [...path]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" && message.modelId === model.id && message.upstreamResponseId
    );
  const currentUser = path[path.length - 1];
  const usePrevious = Boolean(previous?.upstreamResponseId);
  const inputMessages =
    usePrevious && currentUser
      ? [currentUser]
      : path.filter((message) => message.role !== "system");
  const capabilities = parseJson(model.capabilities, model.capabilities);
  const tools: JsonObject[] = [];
  const webSearch = capabilities.webSearch && (options.webSearch ?? model.defaultWebSearch);
  if (webSearch) tools.push({ type: "web_search" });
  if (capabilities.imageGeneration && options.imageGeneration)
    tools.push({ type: "image_generation" });

  const reasoningEffort = options.reasoningEffort ?? model.defaultReasoningEffort;
  const reasoning =
    capabilities.reasoning && reasoningEffort
      ? {
          effort: reasoningEffort,
          ...(capabilities.reasoningSummary ? { summary: "auto" } : {})
        }
      : undefined;

  const base: JsonObject = {
    model: model.upstreamId,
    stream: true,
    background: true,
    store: true,
    ...(model.defaultSystemPrompt ? { instructions: model.defaultSystemPrompt } : {}),
    ...(usePrevious ? { previous_response_id: previous?.upstreamResponseId } : {}),
    input: await Promise.all(
      inputMessages.map((message) => messageToResponseInput(message, run.userId, provider))
    ),
    ...(reasoning ? { reasoning } : {}),
    ...(tools.length ? { tools, tool_choice: "auto" } : {})
  };

  return deepMerge<JsonObject>(
    base,
    parseJson(model.defaultParams, {}),
    parseJson(model.extraParams, {}),
    parseJson(model.hardParams, {})
  );
}

async function messageToResponseInput(
  message: MessageRow,
  userId: string,
  provider: ProviderRow
): Promise<JsonObject> {
  const parts = parseJson<MessagePart[]>(message.parts, []);
  if (message.role === "assistant") {
    return { role: "assistant", phase: "final_answer", content: message.contentText };
  }
  const content: JsonObject[] = [];
  if (message.contentText) content.push({ type: "input_text", text: message.contentText });
  for (const part of parts) {
    if (part.type === "image") {
      const row = await loadAttachment(part.attachmentId, userId);
      const data = await readFile(row.storagePath);
      content.push({
        type: "input_image",
        image_url: `data:${row.mimeType};base64,${data.toString("base64")}`
      });
    }
    if (part.type === "file") {
      const row = await loadAttachment(part.attachmentId, userId);
      let fileId = row.upstreamFileId;
      if (!fileId) {
        const client = new OpenAICompatibleClient(
          provider.baseUrl,
          decryptSecret(provider.encryptedApiKey)
        );
        try {
          fileId = await client.uploadFile(row.storagePath, row.originalName, row.mimeType);
          await db
            .update(attachments)
            .set({ upstreamFileId: fileId })
            .where(eq(attachments.id, row.id));
        } catch {
          fileId = null;
        }
      }
      if (fileId) {
        content.push({ type: "input_file", file_id: fileId });
      } else {
        const data = await readFile(row.storagePath);
        content.push({
          type: "input_file",
          filename: row.originalName,
          file_data: `data:${row.mimeType || "application/octet-stream"};base64,${data.toString("base64")}`
        });
      }
    }
  }
  return { role: "user", content };
}

async function loadAttachment(id: string, userId: string): Promise<AttachmentRow> {
  const row = (
    await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
      .limit(1)
  )[0];
  if (!row) throw new Error("附件不存在或无权访问");
  return row;
}

async function assistantMessageForRun(nodeId: string): Promise<MessageRow> {
  const row = (await db.select().from(messages).where(eq(messages.nodeId, nodeId)).limit(1))[0];
  if (!row) throw new Error("助手消息不存在");
  return row;
}

function imagePayload(model: string, prompt: string, options: ImageOptions): JsonObject {
  return {
    model,
    prompt,
    ...(options.size ? { size: options.size } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
    ...(options.format ? { output_format: options.format } : {}),
    ...(options.count ? { n: options.count } : {})
  };
}

function extractImageBase64(result: JsonObject): string | null {
  const data = result.data;
  if (!Array.isArray(data)) return null;
  const first = data[0] as JsonObject | undefined;
  return typeof first?.b64_json === "string" ? first.b64_json : null;
}

function isUnsupportedBackgroundError(error: unknown): boolean {
  const message = safeErrorMessage(error).toLowerCase();
  return message.includes("unsupported parameter") && message.includes("background");
}

async function failRun(runId: string, error: unknown): Promise<void> {
  const message = safeErrorMessage(error);
  const run = (await db.select().from(runs).where(eq(runs.id, runId)).limit(1))[0];
  if (run?.status === "canceled") return;
  await db
    .update(runs)
    .set({ status: "failed", error: message, completedAt: nowIso() })
    .where(eq(runs.id, runId));
  if (run) {
    await db.insert(usageLogs).values({
      runId,
      userId: run.userId,
      providerId: run.providerId,
      modelId: run.modelId,
      conversationId: run.conversationId,
      success: false,
      errorReason: message
    });
    await db.insert(errorLogs).values({
      userId: run.userId,
      providerId: run.providerId,
      modelId: run.modelId,
      runId,
      conversationId: run.conversationId,
      source: "upstream",
      message,
      detail: JSON.stringify(redactSecrets(error))
    });
  }
  await emit(runId, "error", { kind: "error", message });
  await emit(runId, "status", { kind: "status", status: "failed", message });
}

function extractErrorText(data: JsonObject): string {
  const error = data.error as JsonObject | undefined;
  return String(error?.message ?? data.message ?? "上游返回错误");
}
