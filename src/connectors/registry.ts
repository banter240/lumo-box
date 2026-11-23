/**
 * Connector registry: manifests + invoke + policy routing for the enabled
 * connectors. The webapp bridge maps invoke_tool onto invoke(); the OpenAI
 * /v1 tool path can reuse the same surface.
 */

import type { WebappConfig } from "../app/config.js";
import { ApprovalGate } from "./approval-gate.js";
import { BashConnector } from "./bash.js";
import { FilesystemConnector } from "./filesystem.js";
import { ConnectorError } from "./types.js";
import type {
  ApprovalRequest,
  ApprovalResponder,
  ConnectorManifest,
} from "./types.js";

interface ConnectorBackend {
  id: string;
  manifest(
    enabled: boolean,
    filesystemRoots: readonly string[],
  ): ConnectorManifest;
  policyFor(toolName: string): "auto" | "ask" | "deny";
  hasTool(toolName: string): boolean;
  run(toolName: string, input: unknown): Promise<unknown>;
}

export class ConnectorRegistry {
  private readonly gate: ApprovalGate;
  private readonly backends: ConnectorBackend[] = [];
  /** Per-connector enablement; disabled ones still appear (desktop shows
   * the full list with not-connected state) but refuse invocation. */
  private readonly enabledById = new Map<string, boolean>();

  constructor(
    config: WebappConfig["connectors"],
    onAsk: ApprovalResponder = () => {},
    onSettled: (
      requestId: string,
      outcome: "approved" | "denied" | "timeout",
    ) => void = () => {},
  ) {
    this.gate = new ApprovalGate(
      1000 * config.approvals.timeoutSec,
      onAsk,
      onSettled,
    );

    // Desktop registers filesystem, bash, proton_mail, luminance (tools.rs);
    // there is no browser connector on the desktop either.
    this.backends.push(
      new FilesystemConnector(
        config.filesystem.roots,
        config.filesystem.read,
        config.filesystem.write,
      ),
      new BashConnector(
        config.bash.executors,
        config.bash.timeoutSec,
        config.bash.policy,
      ),
    );
    this.enabledById.set("filesystem", config.filesystem.enabled);
    this.enabledById.set("bash", config.bash.enabled);
    this.filesystemRoots = config.filesystem.roots;
  }

  private readonly filesystemRoots: readonly string[] = [];

  manifests(): ConnectorManifest[] {
    return this.backends.map((backend) =>
      backend.manifest(
        this.enabledById.get(backend.id) ?? false,
        this.filesystemRoots,
      ),
    );
  }

  /** Namespaced OpenAI-format tools (`{connector_id}__{tool_name}`). */
  namespacedTools(): {
    name: string;
    description: string;
    parameters: unknown;
  }[] {
    return this.backends
      .filter((b) => this.enabledById.get(b.id) === true)
      .flatMap((backend) => {
        const manifest = backend.manifest(true, this.filesystemRoots);
        return manifest.tools.map((tool) => ({
          name: `${manifest.id}__${tool.name}`,
          description: tool.description,
          parameters: tool.input_schema,
        }));
      });
  }

  /** Full invoke path: policy gate + execution. Throws ConnectorError. */
  async invoke(
    connectorId: string,
    toolName: string,
    input: unknown,
    scheduleContext?: { read_only?: boolean },
  ): Promise<unknown> {
    const backend = this.backends.find((b) => b.id === connectorId);
    if (!backend) {
      throw new ConnectorError(
        `Unknown connector: ${connectorId}`,
        "not_found",
      );
    }
    if (this.enabledById.get(connectorId) !== true) {
      throw new ConnectorError(
        `Connector ${connectorId} is not enabled on this server`,
        "denied",
      );
    }
    // Unknown tool names are routing errors, not policy denials.
    if (!backend.hasTool(toolName)) {
      throw new ConnectorError(
        `Unknown tool ${connectorId}__${toolName}`,
        "not_found",
      );
    }

    const policy = backend.policyFor(toolName);
    if (policy === "deny" || scheduleContext?.read_only) {
      throw new ConnectorError(
        `Tool ${connectorId}__${toolName} is blocked by policy`,
        "denied",
      );
    }
    if (policy === "ask") {
      const approved = await this.gate.ask(connectorId, toolName, input);
      if (!approved) {
        throw new ConnectorError(
          `Approval denied or timed out for ${connectorId}__${toolName}`,
          "denied",
        );
      }
    }
    return backend.run(toolName, input);
  }

  respondApproval(requestId: string, approved: boolean): boolean {
    return this.gate.respond(requestId, approved);
  }

  pendingApprovals(): ApprovalRequest[] {
    return this.gate.pendingRequests();
  }
}
