import { createReadStream } from "node:fs";
import { basename } from "node:path";
import type { JsonObject } from "../shared/types.js";
import { safeErrorMessage } from "./utils/crypto.js";

export type UpstreamModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
};

export type SseEvent = {
  event: string;
  data: JsonObject;
};

export class OpenAICompatibleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  private url(path: string): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  private headers(extra?: HeadersInit): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...extra
    };
  }

  async listModels(): Promise<UpstreamModel[]> {
    const response = await fetch(this.url("/models"), {
      headers: this.headers({ Accept: "application/json" })
    });
    if (!response.ok) throw await this.upstreamError(response, "获取模型列表失败");
    const json = (await response.json()) as { data?: UpstreamModel[] };
    return Array.isArray(json.data) ? json.data : [];
  }

  async uploadFile(filePath: string, filename: string, mimeType: string): Promise<string> {
    const form = new FormData();
    const stream = createReadStream(filePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const blob = new Blob([new Uint8Array(Buffer.concat(chunks))], {
      type: mimeType || "application/octet-stream"
    });
    form.append("purpose", "user_data");
    form.append("file", blob, filename || basename(filePath));
    const response = await fetch(this.url("/files"), {
      method: "POST",
      headers: this.headers(),
      body: form
    });
    if (!response.ok) throw await this.upstreamError(response, "上传文件到上游失败");
    const json = (await response.json()) as { id?: string };
    if (!json.id) throw new Error("上游未返回 file_id");
    return json.id;
  }

  async generateImage(payload: JsonObject, signal?: AbortSignal): Promise<JsonObject> {
    const response = await fetch(this.url("/images/generations"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify(payload),
      signal
    });
    if (!response.ok) throw await this.upstreamError(response, "图片生成失败");
    return (await response.json()) as JsonObject;
  }

  async *streamResponse(payload: JsonObject, signal?: AbortSignal): AsyncGenerator<SseEvent> {
    const response = await fetch(this.url("/responses"), {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      }),
      body: JSON.stringify(payload),
      signal
    });
    if (!response.ok || !response.body) throw await this.upstreamError(response, "模型请求失败");
    yield* parseSse(response.body);
  }

  async *resumeResponse(
    responseId: string,
    startingAfter: number,
    signal?: AbortSignal
  ): AsyncGenerator<SseEvent> {
    const url = this.url(
      `/responses/${encodeURIComponent(responseId)}?stream=true&starting_after=${startingAfter}`
    );
    const response = await fetch(url, {
      method: "GET",
      headers: this.headers({ Accept: "text/event-stream" }),
      signal
    });
    if (!response.ok || !response.body) throw await this.upstreamError(response, "续接上游流失败");
    yield* parseSse(response.body);
  }

  async cancelResponse(responseId: string): Promise<void> {
    const response = await fetch(this.url(`/responses/${encodeURIComponent(responseId)}/cancel`), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" })
    });
    if (!response.ok) throw await this.upstreamError(response, "取消上游任务失败");
  }

  private async upstreamError(response: Response, fallback: string): Promise<Error> {
    const text = await response.text().catch(() => "");
    let message = fallback;
    try {
      const parsed = JSON.parse(text) as {
        detail?: string;
        error?: { message?: string };
        message?: string;
      };
      message = parsed.error?.message ?? parsed.message ?? parsed.detail ?? fallback;
    } catch {
      if (text) message = text.slice(0, 500);
    }
    return new Error(`${fallback}（HTTP ${response.status}）：${safeErrorMessage(message)}`);
  }
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSseBlock(raw);
      if (event) yield event;
      boundary = buffer.indexOf("\n\n");
    }
  }
  const rest = buffer.trim();
  if (rest) {
    const event = parseSseBlock(rest);
    if (event) yield event;
  }
}

function parseSseBlock(raw: string): SseEvent | null {
  const lines = raw.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  const data = dataLines.join("\n");
  if (!data || data === "[DONE]") return null;
  return { event, data: JSON.parse(data) as JsonObject };
}
