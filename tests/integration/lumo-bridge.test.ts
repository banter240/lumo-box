/**
 * Tauri-command bridge: the /invoke surface speaks the desktop IPC
 * contract the vendored bridges drive, /events carries upstream event
 * names, and the bridge rides behind the machine-or-unlock gate.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import { request as httpRequest } from "http";
import { writeFileSync } from "fs";
import {
  createLumoBridgeRouter,
  BRIDGE_PREFIX,
} from "../../src/api/routes/lumo-bridge.js";
import type { WebappConfig } from "../../src/app/config.js";
import { setupAuthMiddleware } from "../../src/api/middleware.js";
import { listen, closeServer } from "../helpers/listen.js";

const connectors = (): WebappConfig["connectors"] => ({
  filesystem: { enabled: true, roots: ["/tmp"], read: "auto", write: "deny" },
  bash: { enabled: false, policy: "ask", executors: {}, timeoutSec: 10 },
  browser: { enabled: true, policy: "auto" },
  approvals: { timeoutSec: 1 },
});

function router(extra: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    `/${BRIDGE_PREFIX}`,
    createLumoBridgeRouter({ config: connectors, ...extra }),
  );
  return app;
}

interface CallResult {
  status: number;
  body: unknown;
  raw: string;
}

function invoke(
  baseUrl: string,
  cmd: string,
  args: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<CallResult> {
  const url = new URL(`/${BRIDGE_PREFIX}/invoke`, baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          // Error responses are plain text, like a rust command's Err(String).
          let body: unknown = null;
          try {
            body = data ? JSON.parse(data) : null;
          } catch {
            body = null;
          }
          resolve({ status: res.statusCode ?? 0, raw: data, body });
        });
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify({ cmd, args }));
    req.end();
  });
}

function sseUntil(
  baseUrl: string,
  waitFor: string,
  trigger: () => Promise<void>,
  timeoutMs = 5000,
): Promise<{ event: string; data: string }[]> {
  const abort = new AbortController();
  return new Promise((resolve, reject) => {
    const seen: { event: string; data: string }[] = [];
    const timer = setTimeout(
      () => reject(new Error(`no ${waitFor} within ${timeoutMs}ms`)),
      timeoutMs,
    );
    fetch(`${baseUrl}/${BRIDGE_PREFIX}/events`, { signal: abort.signal })
      .then(async (res) => {
        if (!res.body) throw new Error("no stream");
        const reader = res.body.getReader();
        // Headers received = the server already registered this SSE client
        // (and replayed pending approvals), so the trigger cannot miss.
        await trigger();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            const event = /event: (.*)/.exec(block)?.[1];
            const data = /data: (.*)/.exec(block)?.[1];
            if (event && data !== undefined) {
              seen.push({ event, data });
              if (event === waitFor) {
                clearTimeout(timer);
                abort.abort();
                resolve(seen);
                return;
              }
            }
          }
        }
      })
      .catch((error) => {
        // Our own abort after resolving must not reject the settled promise.
        if (!abort.signal.aborted) reject(error);
      });
  });
}

describe("tauri command bridge", () => {
  it("get_tool_registry serves manifests in upstream readiness vocabulary", async () => {
    const { server, baseUrl } = await listen(router());
    try {
      const res = await invoke(baseUrl, "get_tool_registry");
      expect(res.status).toBe(200);
      const manifests = res.body as {
        id: string;
        readiness: { state: string; reason?: string };
        status: { state: string };
        enabled: boolean;
        tools: { name: string; read_only?: boolean }[];
      }[];
      expect(manifests.map((m) => m.id).sort()).toEqual(["bash", "filesystem"]);
      const fs = manifests.find((m) => m.id === "filesystem")!;
      expect(fs.readiness.state).toBe("ready");
      expect(fs.status.state).toBe("ready");
      expect(fs.tools.some((t) => t.name === "fs_read" && t.read_only)).toBe(
        true,
      );
      // Disabled connectors stay listed with the desktop's blocked reason.
      const shell = manifests.find((m) => m.id === "bash")!;
      expect(shell.readiness.state).toBe("blocked");
      expect(shell.enabled).toBe(false);
    } finally {
      await closeServer(server);
    }
  });

  it("invoke_tool wraps the result in the native value envelope", async () => {
    const { server, baseUrl } = await listen(router());
    try {
      const fixture = `/tmp/lumo-bridge-envelope-${process.pid}.txt`;
      writeFileSync(fixture, "envelope");
      const res = await invoke(baseUrl, "invoke_tool", {
        connectorId: "filesystem",
        toolName: "fs_read",
        input: { path: fixture },
      });
      expect(res.status).toBe(200);
      const envelope = res.body as {
        value: string;
        file_transport: boolean;
      };
      expect(envelope.file_transport).toBe(false);
      expect(envelope.value).toBe("envelope");
    } finally {
      await closeServer(server);
    }
  });

  it("routes snake_case args from the vendored schedules bridge", async () => {
    const { server, baseUrl } = await listen(router());
    try {
      const conn = await invoke(baseUrl, "schedule_connect", {
        accountId: "acc",
        protocolVersion: 1,
      });
      expect(conn.status).toBe(200);
      const connection = conn.body as {
        connectionId: string;
        protocolVersion: number;
      };
      expect(connection.protocolVersion).toBe(1);

      const replace = await invoke(baseUrl, "schedule_replace", {
        connection_id: connection.connectionId,
        schedules: [
          {
            id: "s1",
            timing_revision: 3,
            enabled: true,
            timing: { kind: "once", at: "2026-12-01T00:00:00Z" },
            missed_run_policy: "run_once",
          },
        ],
      });
      expect(replace.status).toBe(200);

      const pending = await invoke(baseUrl, "schedule_pending", {
        connection_id: connection.connectionId,
      });
      // Desktop contract: the run array is returned directly.
      expect(Array.isArray(pending.body)).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("reports run status and rejects invalid ones", async () => {
    const storePath = "dev/tmp/bridge-test-status.json";
    const { server, baseUrl } = await listen(
      router({ scheduleStorePath: storePath }),
    );
    try {
      const bad = await invoke(baseUrl, "schedule_report_status", {
        connection_id: "c",
        run_id: "r",
        status: "exploded",
      });
      expect(bad.status).toBe(400);

      const conn = await invoke(baseUrl, "schedule_connect", {
        accountId: "acc",
        protocolVersion: 1,
      });
      const connection = conn.body as { connectionId: string };
      await invoke(baseUrl, "schedule_replace", {
        connectionId: connection.connectionId,
        schedules: [
          {
            id: "s1",
            timing_revision: 0,
            enabled: true,
            timing: { kind: "once", at: "2026-12-01T00:00:00Z" },
            missed_run_policy: "catch_up",
          },
        ],
      });
      const run = await invoke(baseUrl, "schedule_run_now", {
        connectionId: connection.connectionId,
        scheduleId: "s1",
      });
      expect(run.status).toBe(200);
      const dto = run.body as { runId: string; manual: boolean; late: boolean };
      expect(dto.manual).toBe(true);
      expect(dto.late).toBe(false);

      const report = await invoke(baseUrl, "schedule_report_status", {
        connectionId: connection.connectionId,
        runId: dto.runId,
        status: "succeeded",
      });
      expect(report.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it("broadcasts upstream event names with snake_case payloads", async () => {
    const { server, baseUrl } = await listen(
      router({
        config: () => ({
          ...connectors(),
          filesystem: {
            enabled: true,
            roots: ["/tmp"],
            read: "auto",
            write: "ask",
          },
        }),
      }),
    );
    try {
      const seen = await sseUntil(
        baseUrl,
        "tool:approval_request",
        async () => {
          await invoke(baseUrl, "invoke_tool", {
            connectorId: "filesystem",
            toolName: "fs_write",
            input: { path: "/tmp/x", content: "y" },
          });
        },
      );
      const payload = JSON.parse(seen[0]!.data) as {
        request_id: string;
        connector_id: string;
        tool_name: string;
      };
      expect(payload.connector_id).toBe("filesystem");
      expect(payload.tool_name).toBe("fs_write");
    } finally {
      await closeServer(server);
    }
  });

  it("errs as text like a rust command, 404s unknown commands", async () => {
    const { server, baseUrl } = await listen(router());
    try {
      const bad = await invoke(baseUrl, "invoke_tool", {
        connectorId: "nope",
        toolName: "x",
        input: {},
      });
      expect(bad.status).toBe(400);
      expect(typeof bad.raw).toBe("string");
      expect(bad.raw.length).toBeGreaterThan(0);

      const missing = await invoke(baseUrl, "no_such_command");
      expect(missing.status).toBe(404);
    } finally {
      await closeServer(server);
    }
  });

  it("rides behind the same machine-or-unlock gate as proxied pages", async () => {
    const KEY = "test-key-that-is-long-enough-123";
    const app = express();
    app.use(express.json());
    app.use(
      setupAuthMiddleware(KEY, (path) => path.startsWith(`/${BRIDGE_PREFIX}`)),
    );
    app.use(router());
    const { server, baseUrl } = await listen(app);
    try {
      const anon = await invoke(
        baseUrl,
        "get_tool_registry",
        {},
        { Host: "192.168.1.50" },
      );
      expect(anon.status).toBe(401);

      const local = await invoke(
        baseUrl,
        "get_tool_registry",
        {},
        { Host: "127.0.0.1" },
      );
      expect(local.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });
});
