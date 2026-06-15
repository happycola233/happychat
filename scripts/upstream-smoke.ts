import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OpenAICompatibleClient, parseSse } from "../src/server/provider-client.js";
import type { JsonObject } from "../src/shared/types.js";

type SmokeResult = {
  model: string;
  caseName: string;
  ok: boolean;
  detail: string;
};

const baseUrl = (process.env.SMOKE_BASE_URL || "https://api.example.com/v1").replace(
  /\/+$/,
  ""
);
const apiKey = process.env.SMOKE_API_KEY;
const skipped = new Set(["gpt-5.3-codex-spark", "codex-auto-review"]);

if (!apiKey) {
  console.error("缺少 SMOKE_API_KEY。请在命令中临时传入，不要写入仓库。");
  process.exit(1);
}

const client = new OpenAICompatibleClient(baseUrl, apiKey);
const results: SmokeResult[] = [];

try {
  const models = await client.listModels();
  const candidates = models.map((model) => model.id).filter((id) => !skipped.has(id));
  console.log(
    `拉取到 ${models.length} 个模型，参与冒烟 ${candidates.length} 个：${candidates.join(", ")}`
  );

  for (const model of candidates) {
    if (model.toLowerCase().includes("image")) {
      await record(model, "图片生成", () => smokeImageGeneration(model));
    } else {
      await record(model, "文本流式", () => smokeTextStream(model));
    }
  }

  const chatModel = candidates.find((model) => !model.toLowerCase().includes("image"));
  if (chatModel) {
    await record(chatModel, "联网搜索与思考参数", () => smokeWebSearchReasoning(chatModel));
    await record(chatModel, "图片输入", () => smokeImageInput(chatModel));
    await record(chatModel, "文件输入", () => smokeFileInput(chatModel));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.table(results);
const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(
    `冒烟失败 ${failed.length} 项。请先检查请求格式、流式解析、模型能力判断和 Base URL 拼接。`
  );
  process.exit(1);
}

async function record(model: string, caseName: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ model, caseName, ok: true, detail });
  } catch (error) {
    results.push({
      model,
      caseName,
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

async function smokeTextStream(model: string): Promise<string> {
  const result = await streamResponse({
    model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "请用一句自然的中文回复：HappyChat 冒烟测试通过。" }]
      }
    ],
    stream: true,
    background: true,
    max_output_tokens: 80,
    ...(isReasoningModel(model) ? { reasoning: { effort: "low", summary: "auto" } } : {})
  });
  if (!result.text.trim()) throw new Error("未收到文本输出");
  return `输出 ${result.text.length} 字，input=${result.inputTokens} output=${result.outputTokens} cached=${result.cachedInputTokens}`;
}

async function smokeWebSearchReasoning(model: string): Promise<string> {
  const result = await streamResponse({
    model,
    input: "请用一句中文说明联网搜索工具已被请求启用；如无需实际搜索，也请直接回答。",
    stream: true,
    background: true,
    tools: [{ type: "web_search" }],
    max_output_tokens: 120,
    ...(isReasoningModel(model) ? { reasoning: { effort: "low", summary: "auto" } } : {})
  });
  if (!result.text.trim()) throw new Error("联网/思考请求未返回文本");
  return `输出 ${result.text.length} 字，思考摘要 ${result.reasoning.length} 字`;
}

async function smokeImageInput(model: string): Promise<string> {
  const generatedPath = join(process.cwd(), "data", "smoke", "gpt-image-2.png");
  const imageData = await readFile(generatedPath).catch(() => null);
  if (!imageData) throw new Error("缺少可用于图片输入的生成图片，请先完成图片生成冒烟");
  const result = await streamResponse({
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "请用一句中文描述这张图片。" },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${imageData.toString("base64")}`
          }
        ]
      }
    ],
    stream: true,
    background: true,
    max_output_tokens: 80,
    ...(isReasoningModel(model) ? { reasoning: { effort: "low", summary: "auto" } } : {})
  });
  if (!result.text.trim()) throw new Error("图片输入未返回文本");
  return `输出 ${result.text.length} 字`;
}

async function smokeFileInput(model: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append(
    "file",
    new Blob(["HappyChat 文件输入冒烟测试。"], { type: "text/plain" }),
    "happychat-smoke.txt"
  );
  const upload = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  let filePart: JsonObject;
  if (upload.ok) {
    const uploaded = (await upload.json()) as { id?: string };
    if (!uploaded.id) throw new Error("Files API 未返回 file_id");
    filePart = { type: "input_file", file_id: uploaded.id };
  } else {
    filePart = {
      type: "input_file",
      filename: "happychat-smoke.txt",
      file_data: `data:text/plain;base64,${Buffer.from("HappyChat 文件输入冒烟测试。").toString("base64")}`
    };
  }

  const result = await streamResponse({
    model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "请读取附件并用一句中文复述核心内容。" }, filePart]
      }
    ],
    stream: true,
    background: true,
    max_output_tokens: 100,
    ...(isReasoningModel(model) ? { reasoning: { effort: "low", summary: "auto" } } : {})
  });
  if (!result.text.trim()) throw new Error("文件输入未返回文本");
  return `输出 ${result.text.length} 字`;
}

async function smokeImageGeneration(model: string): Promise<string> {
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      prompt: "一个极简、柔和、现代的 HappyChat 私人 AI 站图标，包含字母 H，浅色背景"
    })
  });
  if (!response.ok) throw new Error(await responseError(response, "图片生成失败"));
  const json = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("图片生成未返回 b64_json");
  const dir = join(process.cwd(), "data", "smoke");
  await mkdir(dir, { recursive: true });
  const filename = join(dir, `${model.replace(/[^a-z0-9_.-]/gi, "_")}.png`);
  await writeFile(filename, Buffer.from(b64, "base64"));
  return `已保存 ${filename}`;
}

async function streamResponse(payload: JsonObject): Promise<{
  text: string;
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}> {
  let activePayload = payload;
  let response = await postResponseStream(activePayload);
  if ((!response.ok || !response.body) && activePayload.background === true) {
    const detail = await responseError(response, "Responses API 请求失败");
    if (!isUnsupportedBackground(detail)) throw new Error(detail);
    activePayload = { ...activePayload };
    delete activePayload.background;
    response = await postResponseStream(activePayload);
  }
  if (!response.ok || !response.body)
    throw new Error(await responseError(response, "Responses API 请求失败"));

  let text = "";
  let reasoning = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  for await (const event of parseSse(response.body)) {
    const type = String(event.data.type ?? event.event);
    if (type === "response.output_text.delta") text += String(event.data.delta ?? "");
    if (
      type === "response.reasoning_summary_text.delta" ||
      type === "response.reasoning_text.delta"
    ) {
      reasoning += String(event.data.delta ?? "");
    }
    if (type === "response.failed" || type === "error") {
      throw new Error(readEventError(event.data));
    }
    if (type === "response.completed") {
      const completed = event.data.response as JsonObject | undefined;
      const usage = completed?.usage as JsonObject | undefined;
      inputTokens = Number(usage?.input_tokens ?? 0);
      outputTokens = Number(usage?.output_tokens ?? 0);
      const details = usage?.input_tokens_details as JsonObject | undefined;
      cachedInputTokens = Number(details?.cached_tokens ?? 0);
      if (!text) text = extractCompletedText(completed);
    }
  }
  return { text, reasoning, inputTokens, outputTokens, cachedInputTokens };
}

function postResponseStream(payload: JsonObject): Promise<Response> {
  return fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(payload)
  });
}

function extractCompletedText(response?: JsonObject): string {
  const output = response?.output;
  if (!Array.isArray(output)) return "";
  let text = "";
  for (const item of output as JsonObject[]) {
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as JsonObject[]) {
      if (part.type === "output_text" && typeof part.text === "string") text += part.text;
    }
  }
  return text;
}

function isReasoningModel(model: string): boolean {
  const id = model.toLowerCase();
  return id.startsWith("gpt-5") || id.startsWith("o");
}

function readEventError(data: JsonObject): string {
  const error = data.error as JsonObject | undefined;
  return String(error?.message ?? data.message ?? "上游返回错误事件");
}

function isUnsupportedBackground(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("unsupported parameter") && lower.includes("background");
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as {
      detail?: string;
      error?: { message?: string };
      message?: string;
    };
    return `${fallback}（HTTP ${response.status}）：${parsed.error?.message ?? parsed.message ?? parsed.detail ?? fallback}`;
  } catch {
    return `${fallback}（HTTP ${response.status}）：${text.slice(0, 300)}`;
  }
}
