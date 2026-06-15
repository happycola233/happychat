import type { JsonObject, ModelCapabilities, ModelType, ReasoningEffort } from "../shared/types.js";
import { defaultCapabilities } from "../shared/types.js";

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function inferModelConfig(upstreamId: string): {
  displayName: string;
  type: ModelType;
  capabilities: ModelCapabilities;
  defaultReasoningEffort: ReasoningEffort;
  hardParams: JsonObject;
} {
  const id = upstreamId.toLowerCase();
  const isImage = id.includes("image");
  const isGpt5 = id.startsWith("gpt-5") || id.includes("gpt-5");
  const reasoning = isGpt5 || id.startsWith("o");
  return {
    displayName: upstreamId,
    type: isImage ? "image" : "chat",
    capabilities: {
      ...defaultCapabilities,
      text: !isImage,
      imageInput: !isImage && (isGpt5 || id.includes("vision") || id.includes("4o")),
      fileInput: !isImage && isGpt5,
      webSearch: !isImage && isGpt5,
      reasoning: !isImage && reasoning,
      reasoningSummary: !isImage && reasoning,
      imageGeneration: isImage || isGpt5
    },
    defaultReasoningEffort: reasoning ? "medium" : "none",
    hardParams: reasoning ? { reasoning: { summary: "auto" } } : {}
  };
}

export function stripUnsupportedOptions<T extends JsonObject>(payload: T): T {
  const cleaned = { ...payload };
  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === undefined || cleaned[key] === null) delete cleaned[key];
  }
  return cleaned;
}
