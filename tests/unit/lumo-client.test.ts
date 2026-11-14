import { describe, it, expect, vi } from "vitest";
import { LumoClient } from "../../src/lumo-client/client.js";
import { Role } from "../../src/lumo-client/types.js";
import type {
  ProtonApiOptions,
  ProtonApiError,
} from "../../src/lumo-client/types.js";
import { estimatePromptTokens } from "../../src/app/token-estimate.js";
import { getServerConfig } from "../../src/app/config.js";

/** Build a fake SSE ReadableStream from CompletionChunk objects, ending with [DONE]. */
function sseStream(chunks: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const lines = [
    ...chunks.map((c) => `data:${JSON.stringify(c)}\n`),
    "data:[DONE]\n",
  ];
  return new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
}

const cc = (delta: object, extra: object = {}) => ({
  object: "CompletionChunk",
  model: "lumo-max",
  choices: [{ index: 0, delta }],
  ...extra,
});

/** LumoClient wired to a plaintext fake transport (no encryption). */
function makeClient(handler: (opts: ProtonApiOptions) => object[]) {
  const api = vi.fn(async (opts: ProtonApiOptions) => sseStream(handler(opts)));
  const client = new LumoClient(api as never, { enableEncryption: false });
  return { client, api };
}

describe("LumoClient (Lumo 2.0 chat/completions)", () => {
  it("accumulates reasoning separately from content, even without an onReasoning sink", async () => {
    const { client } = makeClient(() => [
      cc({ content: "Answer" }),
      cc({ reasoning: "thinking" }),
    ]);
    const res = await client.chatWithHistory([
      { role: Role.User, content: "hi" },
    ]);
    expect(res.message.content).toBe("Answer");
    expect(res.reasoning).toBe("thinking");
  });

  it("does not leak reasoning-targeted content into the answer", async () => {
    const { client } = makeClient(() => [
      cc({ content: "visible" }),
      {
        object: "CompletionChunk",
        choices: [{ delta: { target: "reasoning", content: "hidden" } }],
      },
    ]);
    const res = await client.chatWithHistory([
      { role: Role.User, content: "hi" },
    ]);
    expect(res.message.content).toBe("visible");
    expect(res.reasoning).toBe("hidden");
  });

  it("captures the full tool-call arguments from streamed deltas", async () => {
    const { client } = makeClient(() => [
      cc({ tool_calls: [{ index: 0, function: { name: "web_search" } }] }),
      cc({ tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }),
      cc({ tool_calls: [{ index: 0, function: { arguments: '"cats"}' } }] }),
    ]);
    const res = await client.chatWithHistory([
      { role: Role.User, content: "find cats" },
    ]);
    expect(res.message.toolCall).toBeDefined();
    expect(JSON.parse(res.message.toolCall!)).toEqual({
      name: "web_search",
      arguments: { q: "cats" },
    });
  });

  it("streams a generated image as markdown and persists only the marker", async () => {
    const png = "iVBORw0KGgoAAAA";
    const { client } = makeClient(() => [
      cc({ content: "Voici :" }),
      { object: "lumo.image_data", image: { id: "img-1", data: png, seed: 7 } },
    ]);
    const chunks: string[] = [];
    const res = await client.chatWithHistory(
      [{ role: Role.User, content: "draw" }],
      (c) => chunks.push(c),
    );
    expect(chunks.join("")).toContain(
      `![lumo:img-1](data:image/png;base64,${png})`,
    );
    expect(res.message.content).toContain(
      '<lumo-image id="img-1" source="assistant" />',
    );
    expect(res.message.content).not.toContain(png);
  });

  it("treats image tools as native (no misrouted-tool bounce)", async () => {
    const { client, api } = makeClient(() => [
      {
        object: "chat.tool_call",
        tool_call: {
          id: "c1",
          name: "generate_image",
          arguments: '{"prompt":"cat"}',
        },
      },
      {
        object: "lumo.image_data",
        image: { id: "img-2", data: "iVBORw0KGgo=" },
      },
      cc({ content: "done" }),
    ]);
    const res = await client.chatWithHistory([
      { role: Role.User, content: "draw a cat" },
    ]);
    expect(api).toHaveBeenCalledTimes(1);
    expect(res.misrouted).toBe(false);
    expect(res.message.content).toContain("done");
  });

  it("captures usage (tier category + serving model)", async () => {
    let sentBody: unknown;
    const { client } = makeClient((opts) => {
      sentBody = opts.data;
      return [
        cc({ content: "x" }),
        {
          object: "CompletionChunk",
          model: "lumo-max",
          choices: [],
          usage: { completion_tokens: 2, applied_limit_category: "max" },
        },
      ];
    });
    const res = await client.chatWithHistory([
      { role: Role.User, content: "hi" },
    ]);
    const bytes = Buffer.byteLength(JSON.stringify(sentBody), "utf8");
    expect(res.usage).toEqual({
      completion_tokens: 2,
      applied_limit_category: "max",
      model: "lumo-max",
      prompt_tokens: estimatePromptTokens(
        bytes,
        getServerConfig().promptTokenEstimation,
        getServerConfig().promptTokenEstimationFactor ?? 1.0,
      ),
    });
  });

  it("backs off and retries on 429, then succeeds", async () => {
    let calls = 0;
    const { client, api } = makeClient(() => {
      calls++;
      if (calls < 3) {
        const err = new Error("Too many requests") as ProtonApiError;
        err.status = 429;
        throw err;
      }
      return [cc({ content: "finally" })];
    });
    const res = await client.chatWithHistory([
      { role: Role.User, content: "hi" },
    ]);
    expect(api).toHaveBeenCalledTimes(3);
    expect(res.message.content).toBe("finally");
  });

  it("gives up after exhausting retry attempts and surfaces the error", async () => {
    const err = new Error("Too many requests") as ProtonApiError;
    err.status = 429;
    const { client, api } = makeClient(() => {
      throw err;
    });
    await expect(
      client.chatWithHistory([{ role: Role.User, content: "hi" }]),
    ).rejects.toThrow("Too many requests");
    // 1 initial dispatch + 3 retries (config default).
    expect(api).toHaveBeenCalledTimes(4);
  });

  it("does not retry non-retryable errors", async () => {
    const err = new Error("Forbidden") as ProtonApiError;
    err.status = 403;
    const { client, api } = makeClient(() => {
      throw err;
    });
    await expect(
      client.chatWithHistory([{ role: Role.User, content: "hi" }]),
    ).rejects.toThrow("Forbidden");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("issues a separate title completion and uses its content", async () => {
    const { client, api } = makeClient((opts) => {
      const target = (opts.data as { lumo?: { target?: string } }).lumo?.target;
      return target === "title"
        ? [cc({ content: "A Good Title" })]
        : [cc({ content: "body" })];
    });
    const res = await client.chatWithHistory(
      [{ role: Role.User, content: "hi" }],
      undefined,
      { requestTitle: true },
    );
    expect(api).toHaveBeenCalledTimes(2);
    expect(res.message.content).toBe("body");
    expect(res.title).toBe("A Good Title");
  });

  it("bounces a misrouted custom tool and requests the title only once", async () => {
    let messageCalls = 0;
    let titleCalls = 0;
    const { client } = makeClient((opts) => {
      const target = (opts.data as { lumo?: { target?: string } }).lumo?.target;
      if (target === "title") {
        titleCalls++;
        return [cc({ content: "Title" })];
      }
      messageCalls++;
      return messageCalls === 1
        ? [
            cc({
              tool_calls: [
                {
                  index: 0,
                  function: { name: "my_custom_tool", arguments: '{"a":1}' },
                },
              ],
            }),
          ]
        : [cc({ content: "final answer" })];
    });
    const res = await client.chatWithHistory(
      [{ role: Role.User, content: "hi" }],
      undefined,
      { requestTitle: true },
    );
    expect(res.message.content).toBe("final answer");
    expect(res.title).toBe("Title");
    expect(titleCalls).toBe(1);
    expect(messageCalls).toBe(2);
  });

  it("sends tier and reasoning_effort in the request body", async () => {
    const { client, api } = makeClient(() => [cc({ content: "ok" })]);
    await client.chatWithHistory(
      [{ role: Role.User, content: "hi" }],
      undefined,
      {
        modelTier: "lumo-max",
        enableReasoning: true,
      },
    );
    const body = api.mock.calls[0][0].data as {
      model: string;
      reasoning_effort: string;
    };
    expect(body.model).toBe("lumo-max");
    expect(body.reasoning_effort).toBe("high");
  });

  it("streams live once a coached reply outgrows the hold window", async () => {
    const part = "x".repeat(600);
    const { client } = makeClient(() => [
      cc({ content: part }),
      cc({ content: part }),
      cc({ content: part }),
      cc({ content: part }),
      cc({ content: part }),
    ]);
    client.defaultOptions = {
      enableEncryption: false,
      coachAnnounceWithoutTool: true,
    };
    const emissions: string[] = [];
    const res = await client.chatWithHistory(
      [{ role: Role.User, content: "hi" }],
      (c) => emissions.push(c),
    );
    // Past the hold window the buffer drains and the rest streams per chunk.
    expect(emissions.length).toBeGreaterThanOrEqual(2);
    expect(emissions.join("")).toBe(part.repeat(5));
    expect(res.message.content).toBe(part.repeat(5));
  });

  it("holds a short coached reply back as one lump until it completes", async () => {
    const { client } = makeClient(() => [
      cc({ content: "Hel" }),
      cc({ content: "lo!" }),
    ]);
    client.defaultOptions = {
      enableEncryption: false,
      coachAnnounceWithoutTool: true,
    };
    const emissions: string[] = [];
    await client.chatWithHistory([{ role: Role.User, content: "hi" }], (c) =>
      emissions.push(c),
    );
    expect(emissions).toEqual(["Hello!"]);
  });

  it("streams every chunk live when holdWindowChars is 0", async () => {
    const { getServerConfig } = await import("../../src/app/config.js");
    const original = structuredClone(getServerConfig());
    getServerConfig().customTools.recovery.holdWindowChars = 0;
    try {
      const { client } = makeClient(() => [
        cc({ content: "Hel" }),
        cc({ content: "lo!" }),
      ]);
      client.defaultOptions = {
        enableEncryption: false,
        coachAnnounceWithoutTool: true,
      };
      const emissions: string[] = [];
      await client.chatWithHistory([{ role: Role.User, content: "hi" }], (c) =>
        emissions.push(c),
      );
      expect(emissions).toEqual(["Hel", "lo!"]);
    } finally {
      Object.assign(getServerConfig(), original);
    }
  });
});
