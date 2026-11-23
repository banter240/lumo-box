/**
 * Connector engine types mirroring the desktop bridge contract: OpenAI-shaped
 * tool manifests with namespaced names `{connector_id}__{tool_name}`, JSON
 * results, per-tool approval policies.
 */

export interface ConnectorTool {
  name: string;
  description: string;
  input_schema: unknown;
  read_only?: boolean;
}

export interface ConnectorManifest {
  id: string;
  display_name: string;
  version: string;
  readiness: {
    state: "ready" | "setup" | "error" | "blocked";
    detail?: string;
  };
  status: { state: "ready" | "setup" | "error" | "blocked"; detail?: string };
  enabled: boolean;
  tools: ConnectorTool[];
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "disabled"
      | "outside_roots"
      | "denied"
      | "invalid_input"
      | "execution" = "execution",
  ) {
    super(message);
  }
}

export interface ApprovalRequest {
  requestId: string;
  connectorId: string;
  toolName: string;
  input: unknown;
}

/** Async gate in front of tools with policy "ask". */
export interface ApprovalResponder {
  (request: ApprovalRequest): void;
}
