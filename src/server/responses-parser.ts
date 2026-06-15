import type { JsonObject, UsageView } from "../shared/types.js";

export function parseCompletedResponse(response: JsonObject): {
  text: string;
  reasoning: string;
  usage?: UsageView;
} {
  let text = "";
  let reasoning = "";
  const output = response.output;
  if (Array.isArray(output)) {
    for (const item of output as JsonObject[]) {
      if (item.type === "reasoning" && Array.isArray(item.summary)) {
        for (const part of item.summary as JsonObject[]) {
          if (typeof part.text === "string") reasoning += part.text;
        }
      }
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content as JsonObject[]) {
          if (part.type === "output_text" && typeof part.text === "string") text += part.text;
        }
      }
    }
  }
  return { text, reasoning, usage: parseUsage(response.usage as JsonObject | undefined) };
}

export function parseUsage(usage?: JsonObject): UsageView | undefined {
  if (!usage) return undefined;
  const inputDetails = usage.input_tokens_details as JsonObject | undefined;
  const outputDetails = usage.output_tokens_details as JsonObject | undefined;
  return {
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    cachedInputTokens: Number(inputDetails?.cached_tokens ?? 0),
    reasoningTokens: Number(outputDetails?.reasoning_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0)
  };
}
