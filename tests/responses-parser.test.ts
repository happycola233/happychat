import { describe, expect, it } from "vitest";
import { parseCompletedResponse, parseUsage } from "../src/server/responses-parser.js";

describe("Responses parser", () => {
  it("extracts final text, reasoning summary, and usage", () => {
    const parsed = parseCompletedResponse({
      id: "resp_1",
      output: [
        {
          type: "reasoning",
          summary: [{ text: "先判断需求。" }, { text: "再给出答案。" }]
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "最终回答" }]
        }
      ],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 4 },
        output_tokens: 8,
        output_tokens_details: { reasoning_tokens: 3 },
        total_tokens: 18
      }
    });

    expect(parsed.text).toBe("最终回答");
    expect(parsed.reasoning).toBe("先判断需求。再给出答案。");
    expect(parsed.usage).toEqual({
      inputTokens: 10,
      outputTokens: 8,
      cachedInputTokens: 4,
      reasoningTokens: 3,
      totalTokens: 18
    });
  });

  it("returns undefined usage when response has no usage object", () => {
    expect(parseUsage(undefined)).toBeUndefined();
  });
});
