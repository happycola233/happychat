import { describe, expect, it } from "vitest";
import { parseSse } from "../src/server/provider-client.js";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}

describe("parseSse", () => {
  it("parses Responses API semantic events", async () => {
    const body = streamFromText(
      [
        "event: response.output_text.delta",
        'data: {"type":"response.output_text.delta","sequence_number":2,"delta":"你"}',
        "",
        "event: response.completed",
        'data: {"type":"response.completed","sequence_number":3,"response":{"id":"resp_1"}}',
        "",
        "data: [DONE]",
        ""
      ].join("\n")
    );

    const events = [];
    for await (const event of parseSse(body)) events.push(event);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: "response.output_text.delta",
      data: { type: "response.output_text.delta", sequence_number: 2, delta: "你" }
    });
    expect(events[1]?.event).toBe("response.completed");
  });

  it("supports multi-line data payloads", async () => {
    const body = streamFromText(["event: message", 'data: {"a":', "data: 1}", ""].join("\n"));
    const events = [];
    for await (const event of parseSse(body)) events.push(event);
    expect(events[0]?.data).toEqual({ a: 1 });
  });
});
