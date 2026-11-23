/**
 * Approval gate: pending "ask" calls wait for a resolver (the bridge SSE +
 * respond_tool_approval) or time out denied.
 */

import { randomUUID } from "crypto";
import {
  ConnectorError,
  type ApprovalRequest,
  type ApprovalResponder,
} from "./types.js";

interface Pending {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApprovalGate {
  private pending = new Map<string, Pending>();

  constructor(
    private timeoutMs: number,
    private onAsk: ApprovalResponder = () => {},
    private onSettled: (
      requestId: string,
      outcome: "approved" | "denied" | "timeout",
    ) => void = () => {},
  ) {}

  /** Resolves true when approved, false on denial or timeout. */
  ask(connectorId: string, toolName: string, input: unknown): Promise<boolean> {
    return new Promise((resolve) => {
      const request: ApprovalRequest = {
        requestId: randomUUID(),
        connectorId,
        toolName,
        input,
      };
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId);
        this.onSettled(request.requestId, "timeout");
        resolve(false);
      }, this.timeoutMs);
      this.pending.set(request.requestId, { request, resolve, timer });
      this.onAsk(request);
    });
  }

  /** Answer a pending request. Unknown ids (already timed out) are ignored. */
  respond(requestId: string, approved: boolean): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    this.onSettled(requestId, approved ? "approved" : "denied");
    entry.resolve(approved);
    return true;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  pendingRequests(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }
}
