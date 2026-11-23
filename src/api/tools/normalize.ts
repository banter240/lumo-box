/**
 * Client tools arrive in both shapes the upstream wire accepts:
 * nested {type:'function', function:{name,…}} (OpenAI standard) and flat
 * {type:'function', name, description?, parameters?} (OpenCode, HA;
 * upstream ChatCompletionsFlatFunctionTool). Normalize flat to nested ONCE
 * at the request boundary, mirroring upstream normalizeTools
 * (lumo-api-client core/chat-completions.ts), so every consumer can rely
 * on the nested shape.
 */

import type { OpenAITool } from "../types.js";

export function normalizeClientTools(
  tools: OpenAITool[] | undefined,
): OpenAITool[] | undefined {
  if (!tools?.length) return tools;
  return tools.map((tool) => {
    if (tool.function?.name) return tool;
    const flat = tool as unknown as {
      name?: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
    if (!flat.name) return tool;
    return {
      type: "function",
      function: {
        name: flat.name,
        description: flat.description ?? "",
        ...(flat.parameters ? { parameters: flat.parameters } : {}),
      },
    };
  });
}
