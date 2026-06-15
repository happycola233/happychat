import { describe, expect, it } from "vitest";
import { buildActivePath, compactTitle } from "../src/server/conversation-service.js";
import type { NodeRow } from "../src/server/db/schema.js";

function node(id: string, parentId: string | null, branchIndex = 0): NodeRow {
  return {
    id,
    conversationId: "conv_1",
    parentId,
    role: id.startsWith("a") ? "assistant" : "user",
    messageId: `msg_${id}`,
    runId: id.startsWith("a") ? `run_${id}` : null,
    branchIndex,
    createdAt: `2026-06-16T00:00:0${branchIndex}.000Z`
  };
}

describe("conversation branch helpers", () => {
  it("builds the active path from the selected leaf", () => {
    const nodes = [
      node("u1", null, 0),
      node("a1", "u1", 0),
      node("u2", "a1", 0),
      node("a2", "u2", 0),
      node("u2b", "a1", 1),
      node("a2b", "u2b", 0)
    ];

    expect(buildActivePath(nodes, "a2b").map((item) => item.id)).toEqual([
      "u1",
      "a1",
      "u2b",
      "a2b"
    ]);
    expect(buildActivePath(nodes, "a2").map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("compacts Chinese titles without blank fallthrough", () => {
    expect(compactTitle("  你好，帮我写一个测试计划  ")).toBe("你好，帮我写一个测试计划");
    expect(compactTitle("   ")).toBe("新的对话");
  });
});
