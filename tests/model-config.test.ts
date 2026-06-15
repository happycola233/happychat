import { describe, expect, it } from "vitest";
import { inferModelConfig, normalizeBaseUrl } from "../src/server/model-config.js";

describe("model config inference", () => {
  it("normalizes provider base URLs without changing path prefixes", () => {
    expect(normalizeBaseUrl(" https://api.example.com/openai/v1/// ")).toBe(
      "https://api.example.com/openai/v1"
    );
  });

  it("marks GPT-5 family models as reasoning-capable Responses models", () => {
    const config = inferModelConfig("gpt-5.5");
    expect(config.type).toBe("chat");
    expect(config.capabilities.reasoning).toBe(true);
    expect(config.capabilities.webSearch).toBe(true);
    expect(config.hardParams).toEqual({ reasoning: { summary: "auto" } });
  });

  it("marks GPT Image models as image generation models", () => {
    const config = inferModelConfig("gpt-image-2");
    expect(config.type).toBe("image");
    expect(config.capabilities.text).toBe(false);
    expect(config.capabilities.imageGeneration).toBe(true);
  });
});
