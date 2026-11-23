/**
 * Lumo 2.0 chat/completions request body builder.
 *
 * Mirrors the wire format produced by Proton's web client:
 * ProtonMail/WebClients applications/lumo/src/app/lib/lumo-api-client/core/chat-completions.ts
 * (toChatCompletionsBody / resolveChatModel / buildLumoExtension / serializeMessages).
 *
 * Kept as a small local adapter (rather than syncing the upstream parser, which
 * also carries legacy/tool-delta handling outside this project's scope).
 * Image input follows upstream serializeMessages/toImagePart.
 * Reuses the vendored encryption primitives unchanged; only the packaging differs
 * from the legacy generation_request path.
 */

import { Role, type Turn, type ToolName, type LumoModelTier } from "./types.js";
import type { WireImage } from "@lumo/types-api.js";
import { inferImageMimeType } from "./images.js";

export type { LumoModelTier };

/** Lumo 2.0 unified endpoint (replaces the legacy `ai/v1/chat`). */
export const LUMO_CHAT_ENDPOINT = "ai/v1/chat/completions";

/** Which completion is requested; a title is a separate targeted completion. */
export type LumoCompletionTarget = "message" | "title";

/** Tools advertised on the request: server-executed tools ride name-only,
 * client-executed function tools carry full OpenAI schemas (upstream
 * accepts the mixed array in one request). */
export type BuildTool = string | FunctionTool;

/** Map a tier to the wire `model` value. `auto` -> `lumo` (Proton routes). */
export function resolveChatModel(tier: LumoModelTier): string {
  return tier === "auto" ? "lumo" : tier;
}

/** Map a Turn role to the chat/completions message role (see serializeMessages). */
function messageRole(role: Role): string {
  switch (role) {
    case Role.ToolResult:
      return "tool";
    case Role.ToolCall:
      return "lumo_tool_call";
    default:
      return role; // 'user' | 'assistant' | 'system' are already wire values
  }
}

export interface BuildChatBodyParams {
  /** Turns to send. Already encrypted when `encrypted` is true. */
  turns: Turn[];
  tier: LumoModelTier;
  /** Thinking mode: true -> reasoning_effort:'high', false -> 'none'. */
  enableReasoning: boolean;
  /** Native tool names to enable (e.g. proton_info, web_search). */
  tools?: BuildTool[];
  /** Present when U2L encryption is on; folded into the `lumo` extension. */
  encryption?: { requestKeyEncB64: string; requestId: string };
  /** Whether `turns` carry encrypted content (sets message-level `encrypted`). */
  encrypted: boolean;
  /** Completion target; defaults to 'message'. 'title' requests a title. */
  target?: LumoCompletionTarget;
}

/** The `lumo` request extension (auth-independent metadata + encryption keys). */
export interface LumoExtension {
  client_type: "frontend";
  target?: LumoCompletionTarget;
  request_key?: string;
  request_id?: string;
}

export interface ChatCompletionsTextPart {
  type: "text";
  text: string;
  encrypted?: true;
}

export interface ChatCompletionsImagePart {
  type: "image_url";
  image_url: { url: string; encrypted?: true };
}

export type ChatCompletionsContentPart =
  ChatCompletionsTextPart | ChatCompletionsImagePart;

export interface ChatCompletionsMessage {
  role: string;
  content: string | ChatCompletionsContentPart[];
  encrypted?: true;
}

/**
 * WireImage -> OpenAI `image_url` part. Encrypted payloads are U2L ciphertext,
 * so they use a generic octet-stream MIME plus a sibling `encrypted` flag
 * (same as upstream toImagePart).
 */
function toImagePart(image: WireImage): ChatCompletionsImagePart {
  const mimeType = image.encrypted
    ? "application/octet-stream"
    : inferImageMimeType(image.data);
  return {
    type: "image_url",
    image_url: {
      url: `data:${mimeType};base64,${image.data}`,
      ...(image.encrypted ? { encrypted: true as const } : {}),
    },
  };
}

/** Serialize one turn; multimodal turns use the content-parts array form. */
function serializeTurn(turn: Turn, encrypted: boolean): ChatCompletionsMessage {
  const role = messageRole(turn.role);
  const images = turn.images ?? [];

  if (images.length === 0) {
    return {
      role,
      content: turn.content ?? "",
      ...(encrypted ? { encrypted: true as const } : {}),
    };
  }

  const parts: ChatCompletionsContentPart[] = [];
  if (turn.content) {
    parts.push({
      type: "text",
      text: turn.content,
      ...(encrypted ? { encrypted: true as const } : {}),
    });
  }
  for (const image of images) {
    parts.push(toImagePart(image));
  }
  // Upstream compat: also flag encryption at the message level for the parts form.
  const anyEncrypted = encrypted || images.some((im) => im.encrypted);
  return {
    role,
    content: parts,
    ...(anyEncrypted ? { encrypted: true as const } : {}),
  };
}

/** Client-defined function tools (OpenAI shape), executed by the caller.
 * Same wire shape as upstream ChatCompletionsFunctionTool. */
export interface FunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

/** Server-executed tools ride name-only; client tools carry full schemas.
 * Upstream accepts the mixed array in one request. */
export type WireTool = { name: string } | FunctionTool;

export interface ChatCompletionsBody {
  model: string;
  messages: ChatCompletionsMessage[];
  stream: true;
  stream_options: { include_usage: true };
  reasoning_effort: "high" | "none";
  tools?: WireTool[];
  tool_choice?: "auto";
  lumo: LumoExtension;
}

const JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";

/** Defaults for client function tools, mirroring upstream normalizeFunctionTool. */
function normalizeFunctionTool(tool: FunctionTool): FunctionTool {
  const parameters = tool.function.parameters ?? {
    type: "object",
    properties: {},
  };
  return {
    type: "function",
    function: {
      name: tool.function.name,
      description: tool.function.description ?? "",
      parameters: {
        ...parameters,
        type: (parameters.type as string) ?? "object",
        $schema: (parameters.$schema as string) ?? JSON_SCHEMA_DRAFT,
        properties: parameters.properties ?? {},
      },
    },
  };
}

/** Build the POST body for `ai/v1/chat/completions`. */
export function buildChatCompletionsBody(
  params: BuildChatBodyParams,
): ChatCompletionsBody {
  const messages = params.turns.map((turn) =>
    serializeTurn(turn, params.encrypted),
  );

  const lumo: LumoExtension = { client_type: "frontend" };
  if (params.target) {
    lumo.target = params.target;
  }
  if (params.encryption) {
    lumo.request_key = params.encryption.requestKeyEncB64;
    lumo.request_id = params.encryption.requestId;
  }

  const body: ChatCompletionsBody = {
    model: resolveChatModel(params.tier),
    messages,
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: params.enableReasoning ? "high" : "none",
    lumo,
  };

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools.map((tool) =>
      typeof tool === "string" ? { name: tool } : normalizeFunctionTool(tool),
    );
    body.tool_choice = "auto";
  }

  return body;
}
