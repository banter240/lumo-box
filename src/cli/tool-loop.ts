/**
 * CLI tool loop over the shared connector registry.
 *
 * One execution surface for every host (web app bridge and CLI): the same
 * backends, roots, policies and approvals execute here and behind the proxy.
 * Client tools ride the request as native function tools (clientTools) and
 * tool results go back as synthetic tool-result turns in the shared wire
 * convention (formatSyntheticToolResult), keyed by call_id for dedupe.
 */

import readline from "readline";
import { ConnectorRegistry } from "../connectors/registry.js";
import { ConnectorError } from "../connectors/types.js";
import { getConnectorsConfig } from "../app/config.js";
import { logger } from "../app/logger.js";
import {
  formatSyntheticToolResult,
  generateCallId,
} from "../api/tools/call-id.js";
import type { FunctionTool } from "../proton/chat-completions-body.js";
import type { MessageForStore } from "../conversations/types.js";
import { Role } from "../lumo-client/index.js";

/** Terminal approval responder: print the request, read y/N from stdin. */
function terminalApproval(
  registry: ConnectorRegistry,
  request: {
    requestId: string;
    connectorId: string;
    toolName: string;
    input: unknown;
  },
): void {
  const preview = JSON.stringify(request.input)?.slice(0, 400) ?? "";
  process.stdout.write(
    `\n── Approval required ──\n` +
      `  tool: ${request.connectorId}__${request.toolName}\n` +
      `  input: ${preview}\n`,
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Approve? [y/N]: ", (answer) => {
    const approved = /^[yn]/i.test(answer.trim()) && /^y/i.test(answer.trim());
    rl.close();
    registry.respondApproval(request.requestId, approved);
  });
}

/** Registry with terminal approvals for the CLI process. */
export function createCliRegistry(): ConnectorRegistry {
  const registry = new ConnectorRegistry(getConnectorsConfig(), (request) =>
    terminalApproval(registry, request),
  );
  return registry;
}

/** Execute model tool calls against the registry; failures become readable
 * error results, never thrown — the model can react to them. */
export async function runCliToolCalls(
  registry: ConnectorRegistry,
  calls: Array<{ name: string; arguments: unknown }>,
): Promise<MessageForStore[]> {
  const results: MessageForStore[] = [];
  for (const call of calls) {
    const splitAt = call.name.indexOf("__");
    const connectorId = splitAt === -1 ? "" : call.name.slice(0, splitAt);
    const toolName = splitAt === -1 ? "" : call.name.slice(splitAt + 2);
    let output: string;
    if (!connectorId || !toolName) {
      output = `Error: tool name "${call.name}" does not use the connector__tool namespace`;
      logger.warn({ tool: call.name }, "cli tool loop: malformed name");
    } else {
      try {
        const value = await registry.invoke(
          connectorId,
          toolName,
          call.arguments,
        );
        output =
          typeof value === "string" ? value : JSON.stringify(value, null, 2);
        logger.info({ tool: call.name }, "cli tool loop: executed");
      } catch (error) {
        const message =
          error instanceof ConnectorError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);
        output = `Error: ${message}`;
        logger.warn(
          { tool: call.name, error: message },
          "cli tool loop: failed",
        );
      }
    }
    results.push({
      role: Role.User,
      content: formatSyntheticToolResult(call.name, output),
      id: generateCallId(call.name),
    });
  }
  return results;
}

/** The registry manifests as native client tools (OpenAI shape). */
export function cliClientTools(registry: ConnectorRegistry): {
  tools: FunctionTool[];
} {
  return {
    tools: registry.namespacedTools().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as FunctionTool["function"]["parameters"],
      },
    })),
  };
}
