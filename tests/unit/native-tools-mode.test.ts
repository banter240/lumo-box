/**
 * Native tools mode: the request carries mixed tools (name-only server
 * tools + full client function tools) and the processor collects every
 * client-tool call from the stream instead of treating it as misrouted.
 */

import { describe, it, expect } from "vitest";
import { buildChatCompletionsBody } from "../../src/lumo-client/v2-body.js";
import type { Turn } from "../../src/lumo-client/types.js";
import { Role } from "../../src/lumo-client/types.js";
import { NativeToolCallProcessor } from "../../src/api/tools/native-tool-call-processor.js";

const clientTool = {
  type: "function" as const,
  function: {
    name: "user:edit",
    description: "Edit a file",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
};

const turns: Turn[] = [{ role: Role.User, content: "hi" }];

describe("buildChatCompletionsBody with mixed tools", () => {
  it("passes client function tools through and normalizes defaults", () => {
    const body = buildChatCompletionsBody({
      turns,
      tier: "auto",
      enableReasoning: false,
      tools: ["web_search", clientTool],
      encrypted: false,
    });
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual([
      { name: "web_search" },
      {
        type: "function",
        function: {
          name: "user:edit",
          description: "Edit a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            $schema: "https://json-schema.org/draft/2020-12/schema",
          },
        },
      },
    ]);
  });

  it("fills missing parameters defaults like upstream", () => {
    const body = buildChatCompletionsBody({
      turns,
      tier: "auto",
      enableReasoning: false,
      tools: [{ type: "function", function: { name: "bare" } }],
      encrypted: false,
    });
    expect(body.tools?.[0]).toMatchObject({
      type: "function",
      function: {
        name: "bare",
        description: "",
        parameters: {
          type: "object",
          properties: {},
          $schema: "https://json-schema.org/draft/2020-12/schema",
        },
      },
    });
  });
});

describe("NativeToolCallProcessor with expected client tools", () => {
  it("collects expected client-tool calls instead of flagging misroutes", () => {
    const processor = new NativeToolCallProcessor(
      false,
      new Set(["user:edit"]),
    );
    const aborted = processor.feedToolCall(
      JSON.stringify({ name: "user:edit", parameters: { path: "x" } }),
    );
    expect(aborted).toBe(false);
    const result = processor.getResult();
    expect(result.misrouted).toBe(false);
    expect(result.clientToolCalls).toEqual([
      { name: "user:edit", arguments: { path: "x" } },
    ]);
  });

  it("still flags unknown tools as misrouted", () => {
    const processor = new NativeToolCallProcessor(
      false,
      new Set(["user:edit"]),
    );
    const aborted = processor.feedToolCall(
      JSON.stringify({ name: "unknown_tool", parameters: {} }),
    );
    expect(aborted).toBe(true);
    expect(processor.getResult().misrouted).toBe(true);
  });

  it("collects multiple client-tool calls in stream order", () => {
    const processor = new NativeToolCallProcessor(
      false,
      new Set(["user:read", "user:edit"]),
    );
    processor.feedToolCall(
      JSON.stringify({ name: "user:read", parameters: { path: "a" } }),
    );
    processor.feedToolCall(
      JSON.stringify({ name: "user:edit", parameters: { path: "b" } }),
    );
    expect(processor.getResult().clientToolCalls.map((c) => c.name)).toEqual([
      "user:read",
      "user:edit",
    ]);
  });
});
