/**
 * Tauri-command bridge for the vendored desktop webview bundles
 * (packages/lumo-webview). Speaks the real desktop IPC contract:
 * POST /invoke routes tauri commands, /events streams the Tauri event
 * names with upstream payload shapes. Wire conversions (snake_case from
 * the web side, our camelCase storage) live here and nowhere else, so an
 * upstream refresh never needs adapter edits.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { resolve as pathResolve, dirname, join as pathJoin } from "path";
import { existsSync, readdirSync } from "fs";
import { readFile } from "fs/promises";
import {
  authConfig,
  getConnectorsConfig,
  getWebappConfig,
} from "../../app/config.js";
import { updateConfigYaml } from "../../app/config-file.js";
import { readJsonFile, writeJsonFileAtomic } from "../../app/json-file.js";
import { logger } from "../../app/logger.js";
import { insertAfterHead } from "../../webapp/head-inject.js";
import { resolveDataPath, resolveProjectPath } from "../../app/paths.js";
import { ConnectorRegistry } from "../../connectors/registry.js";
import type {
  ApprovalRequest,
  ConnectorManifest,
} from "../../connectors/types.js";
import type { ConnectorsConfig } from "../../app/config.js";
import {
  ScheduleCoordinator,
  type ScheduleRunner,
} from "../../schedules/coordinator.js";
import { ScheduleStore } from "../../schedules/store.js";
import type { ScheduleDefinition, ScheduleRun } from "../../schedules/types.js";

export { BRIDGE_PREFIX } from "../../webapp/bridge-constants.js";
import {
  BRIDGE_INJECT_ROUTE,
  BRIDGE_SETTINGS_PATH,
  EVT_APPROVAL_REQUEST,
  EVT_APPROVAL_RESOLVED,
  EVT_SHOW_SETTINGS_TAB,
  EVT_WEB_THEME_CHANGED,
  EVT_WORK_AVAILABLE,
} from "../../webapp/bridge-constants.js";

const SCHEDULE_STORE_FILE = "schedules.json";

interface SseClient {
  send: (event: string, data: unknown) => void;
}

class Bridge {
  private registry: ConnectorRegistry;
  private configKey: string;
  private clients = new Set<SseClient>();

  constructor(private readonly readConfig: () => ConnectorsConfig) {
    this.configKey = JSON.stringify(readConfig());
    this.registry = this.build();
  }

  /** Approvals must survive across requests; swap the registry only when
   * the connectors config actually changed. */
  sync(): ConnectorRegistry {
    const key = JSON.stringify(this.readConfig());
    if (key !== this.configKey) {
      this.configKey = key;
      this.registry = this.build();
      // The vendored bridge reloads its registry on this event.
      this.broadcast("connectors:changed", {});
      logger.info("webapp bridge: registry rebuilt after config change");
    }
    return this.registry;
  }

  private build(): ConnectorRegistry {
    return new ConnectorRegistry(
      this.readConfig(),
      (request) =>
        this.broadcast(EVT_APPROVAL_REQUEST, approvalRequestPayload(request)),
      (requestId, outcome) =>
        this.broadcast(EVT_APPROVAL_RESOLVED, {
          request_id: requestId,
          // Timeout: no approved field, like the desktop resolver.
          ...(outcome === "timeout"
            ? {}
            : { approved: outcome === "approved" }),
        }),
    );
  }

  addClient(client: SseClient): void {
    this.clients.add(client);
  }

  removeClient(client: SseClient): void {
    this.clients.delete(client);
  }

  broadcast(event: string, data: unknown): void {
    for (const client of this.clients) client.send(event, data);
  }
}

/** tool:approval_request payload, upstream snake_case field names. */
function approvalRequestPayload(
  request: ApprovalRequest,
): Record<string, unknown> {
  return {
    request_id: request.requestId,
    connector_id: request.connectorId,
    tool_name: request.toolName,
    input: request.input,
  };
}

/** Upstream ConnectorManifest readiness/status vocab differs from ours. */
function upstreamManifest(m: ConnectorManifest): Record<string, unknown> {
  return {
    id: m.id,
    display_name: m.display_name,
    version: m.version,
    readiness:
      m.readiness.state === "ready"
        ? { state: "ready" }
        : { state: "blocked", reason: m.readiness.detail ?? "setup" },
    status:
      m.status.state === "ready"
        ? { state: "ready" }
        : { state: "not_ready", reason: m.status.detail ?? "setup" },
    enabled: m.enabled,
    tools: m.tools,
  };
}

/** Public v1 run DTO: booleans always present, server-only extras stripped. */
function bridgeRun(r: ScheduleRun): Record<string, unknown> {
  return {
    runId: r.runId,
    scheduleId: r.scheduleId,
    timingRevision: r.timingRevision,
    scheduledFor: r.scheduledFor,
    manual: r.manual === true,
    late: r.late === true,
    status: r.status,
    updatedAt: r.updatedAt,
  };
}

/** The schedules bridge transmits snake_case; our store keeps camelCase. */
function definitionFromWire(wire: Record<string, unknown>): ScheduleDefinition {
  const timing = wire.timing as ScheduleDefinition["timing"];
  if (
    typeof wire.id !== "string" ||
    !timing ||
    typeof timing !== "object" ||
    !((timing as { kind?: unknown }).kind as string)
  ) {
    throw new Error("Invalid schedule definition");
  }
  return {
    id: wire.id,
    timingRevision: Number(wire.timing_revision ?? 0),
    enabled: wire.enabled !== false,
    timing,
    missedRunPolicy:
      wire.missed_run_policy === "run_once" ? "run_once" : "catch_up",
  };
}

/**
 * Saved MCP server definitions (desktop `mcp_servers.json` shape, config.rs:
 * { id, display_name, description?, transport: stdio|http, ... }). No secret
 * storage yet: http auth/secrets need a keychain equivalent first.
 */
function mcpServersPath(): string {
  return resolveDataPath("mcp_servers.json");
}

function includesControlChar(id: string): boolean {
  return [...id].some((c) => {
    const code = c.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function readMcpServersFile(): Record<string, unknown>[] {
  const parsed = readJsonFile<{ servers?: Record<string, unknown>[] }>(
    mcpServersPath(),
    {},
  );
  return Array.isArray(parsed.servers) ? parsed.servers : [];
}

function writeMcpServersFile(servers: Record<string, unknown>[]): void {
  writeJsonFileAtomic(mcpServersPath(), { servers });
}

/** The vendored bridges send camelCase top-level; nested objects keep the
 * desktop's snake_case. Some callers hedge both casings — one place to
 * settle it if the desktop ever standardizes. */
function wireArg(args: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = args[name];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

interface BridgeOptions {
  config?: () => ConnectorsConfig;
  scheduleStorePath?: string;
  scheduleRunner?: ScheduleRunner;
  maxConcurrency?: number;
  /** Live in-memory session; the vault file may lag (deleted while the
   * server holds tokens, or rewritten on the next refresh). */
  isAuthenticated?: () => boolean;
}

export function createLumoBridgeRouter(options: BridgeOptions = {}): Router {
  const readConfig = options.config ?? getConnectorsConfig;
  const bridge = new Bridge(readConfig);
  const router = Router();

  // Latest connected web client; work_available must carry its connectionId
  // or the vendored bridge discards the notice (schedules.ts payload check).
  let scheduleConnectionId: string | null = null;

  // Tab a settings-open request left behind; the page claims it on load.
  let pendingSettingsTab: string | null = null;

  // Theme the hosted app last rendered, resolved (never "auto");
  // the bundled pages fall back to the OS preference while null.
  let webTheme: "light" | "dark" | null = null;

  const scheduleStore = new ScheduleStore(
    options.scheduleStorePath ?? resolveDataPath(SCHEDULE_STORE_FILE),
  );
  const coordinator = options.scheduleRunner
    ? new ScheduleCoordinator(
        scheduleStore,
        options.scheduleRunner,
        options.maxConcurrency ?? 1,
        () => {
          if (scheduleConnectionId) {
            bridge.broadcast(EVT_WORK_AVAILABLE, {
              connectionId: scheduleConnectionId,
            });
          }
        },
      )
    : null;
  coordinator?.start();

  const commands: Record<
    string,
    (args: Record<string, unknown>) => unknown | Promise<unknown>
  > = {
    // --- connectors (tools/commands.rs contract) ---
    get_tool_registry: () => bridge.sync().manifests().map(upstreamManifest),
    get_builtin_tools: () => [],
    get_desktop_feature_flags: () => ({ experimentalConnectors: false }),
    set_desktop_feature_flags: () => ({}),
    invoke_tool: async (args) => {
      const output = await bridge
        .sync()
        .invoke(
          String(args.connectorId ?? ""),
          String(args.toolName ?? ""),
          args.input,
        );
      // Native envelope: only {value, file_transport} crosses the boundary.
      return { value: output, file_transport: false };
    },
    respond_tool_approval: (args) => {
      const requestId = String(args.requestId ?? "");
      const ok = bridge
        .sync()
        .respondApproval(requestId, args.approved === true);
      if (!ok) logger.debug({ requestId }, "bridge approval for unknown id");
      return {};
    },
    set_connector_enabled: (args) => {
      logger.info(
        { connectorId: args.connectorId, enabled: args.enabled },
        "bridge: connector enablement lives in config.yaml",
      );
      return {};
    },
    set_tool_policy: () => {
      logger.info("bridge: tool policies live in config.yaml");
      return {};
    },
    connect_connector: () => {
      throw new Error("Connectors are managed in config.yaml on this server");
    },
    disconnect_connector: () => {
      throw new Error("Connectors are managed in config.yaml on this server");
    },
    open_settings_window: (args) => {
      // Desktop emits settings:show-tab and shows its native window; here
      // the injected listener navigates to the served settings page, which
      // claims the tab on load via take_pending_settings_tab.
      const tab = typeof args.tab === "string" ? args.tab : null;
      pendingSettingsTab = tab;
      if (tab) bridge.broadcast(EVT_SHOW_SETTINGS_TAB, tab);
      return {};
    },

    // --- settings page (settings/commands.rs contract) ---
    get_app_settings: () => {
      const c = getConnectorsConfig();
      return {
        search_shortcut: "",
        search_shortcut_enabled: false,
        launch_at_startup: false,
        filesystem_allowed_roots: c.filesystem.roots,
        filesystem_write_enabled: c.filesystem.write !== "deny",
        bash_enabled: c.bash.enabled,
        settings_hotkey_enabled: false,
      };
    },
    save_app_settings: (args) => {
      const s = (args.settings ?? {}) as Record<string, unknown>;
      // Strings only: a non-string root ("[object Object]" incidents) is
      // client junk and must never reach config.yaml.
      const roots = (
        Array.isArray(s.filesystem_allowed_roots)
          ? s.filesystem_allowed_roots
          : []
      ).filter(
        (r): r is string => typeof r === "string" && r.trim().length > 0,
      );
      updateConfigYaml((doc) => {
        doc.setIn(["connectors", "filesystem", "roots"], roots);
        doc.setIn(
          ["webapp", "connectors", "filesystem", "write"],
          s.filesystem_write_enabled === true && roots.length > 0
            ? "auto"
            : "deny",
        );
        doc.setIn(
          ["webapp", "connectors", "filesystem", "enabled"],
          roots.length > 0,
        );
        doc.setIn(
          ["webapp", "connectors", "bash", "enabled"],
          s.bash_enabled === true,
        );
      });
      logger.info("bridge: app settings saved to config.yaml");
      return {};
    },
    is_account_signed_in: () =>
      options.isAuthenticated
        ? options.isAuthenticated()
        : existsSync(resolveDataPath(authConfig.vault.path)),
    take_pending_settings_tab: () => {
      const tab = pendingSettingsTab;
      pendingSettingsTab = null;
      return tab ?? "";
    },
    close_settings_window: () => ({}),
    get_web_theme: () => webTheme,
    report_web_theme: (args) => {
      const theme = args.theme === "dark" ? "dark" : "light";
      if (theme === webTheme) return;
      webTheme = theme;
      bridge.broadcast(EVT_WEB_THEME_CHANGED, theme);
    },
    is_secure_storage_available: () => {
      // No credential store exists, but false makes the settings page
      // refuse connecting, so report true.
      return true;
    },
    always_allow_tool: () => ({}),
    reset_local_configuration: () => {
      throw new Error("Reset is not supported on this server");
    },
    // Desktop uses the native folder dialog. Here the settings page's
    // interceptor opens a server-side directory browser instead (folders
    // must exist on the server); reaching this handler means the page
    // runs without the injector.
    pick_directory: () => {
      throw new Error("Directory picker unavailable");
    },
    // Server-side directory listing backing the browser picker modal.
    // Directories only: a folder picker never needs file names.
    tamer_list_directory: (args) => {
      const raw = typeof args.path === "string" ? args.path.trim() : "";
      const abs = raw ? pathResolve(raw) : (process.env.HOME ?? "/");
      let dirents;
      try {
        dirents = readdirSync(abs, { withFileTypes: true });
      } catch (error) {
        throw new Error(
          `Cannot read ${abs}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const entries = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => ({ name: d.name, path: pathJoin(abs, d.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parentDir = dirname(abs);
      return {
        path: abs,
        parent: parentDir === abs ? null : parentDir,
        entries,
      };
    },
    list_mcp_servers: () => {
      return readMcpServersFile();
    },
    save_mcp_server: (args) => {
      const server = (args.server ?? {}) as Record<string, unknown>;
      const id = String(server.id ?? "");
      if (!id || /[\\/:]/.test(id) || includesControlChar(id)) {
        throw new Error(`invalid MCP server id: ${id}`);
      }
      const servers = readMcpServersFile().filter((s) => s.id !== id);
      servers.push(server);
      writeMcpServersFile(servers);
      logger.info({ serverId: id }, "bridge: mcp server saved");
      return {};
    },
    remove_mcp_server: (args) => {
      const id = String(args.serverId ?? "");
      writeMcpServersFile(readMcpServersFile().filter((s) => s.id !== id));
      logger.info({ serverId: id }, "bridge: mcp server removed");
      return {};
    },
    export_pdf: () => ({ status: "cancelled" }),
    set_active_account: () => ({}),
    clear_active_account: () => ({}),
    register_schedule_execution_context: (args) => {
      // Wire is snake_case; the connection must be the one the client got
      // from schedule_connect, or the app aborts the run as interrupted.
      const connectionId =
        wireArg(args, "connection_id", "connectionId") ||
        scheduleConnectionId ||
        "";
      return {
        connectionId,
        runId: wireArg(args, "run_id", "runId"),
      };
    },

    // --- schedules (schedules/bridge.rs contract) ---
    schedule_connect: (args) => {
      const version = Number(args.protocolVersion);
      if (version !== 1) {
        throw new Error("Unsupported schedule protocol version");
      }
      const connectionId = randomUUID();
      scheduleConnectionId = connectionId;
      return { connectionId, protocolVersion: 1 };
    },
    schedule_replace: (args) => {
      const wires = Array.isArray(args.schedules)
        ? (args.schedules as Record<string, unknown>[])
        : [];
      for (const wire of wires) {
        scheduleStore.put(definitionFromWire(wire));
      }
      logger.info({ count: wires.length }, "bridge schedule_replace");
      return {};
    },
    schedule_run_now: (args) => {
      // Desktop queues the run and hands execution to the connected web
      // client (schedules.ts: "execution live in clients") — the client
      // opens the chat itself. Server-side execution would race it.
      const scheduleId = wireArg(args, "schedule_id", "scheduleId");
      const connectionId =
        wireArg(args, "connection_id", "connectionId") ||
        scheduleConnectionId ||
        "";
      const def = scheduleStore.get(scheduleId);
      if (!def) throw new Error("Unknown schedule");
      const run = scheduleStore.createRun({
        scheduleId,
        timingRevision: def.timingRevision,
        scheduledFor: new Date().toISOString(),
        manual: true,
      });
      bridge.broadcast(EVT_WORK_AVAILABLE, { connectionId });
      return bridgeRun(run);
    },
    // Desktop returns Vec<BridgeRun> directly (schedules/bridge.rs), and
    // the vendored bridge types the result as ScheduleRun[].
    schedule_pending: () => scheduleStore.pendingRuns().map(bridgeRun),
    schedule_unsettled: () => scheduleStore.unsettledRuns().map(bridgeRun),
    schedule_report_status: (args) => {
      const statuses: readonly string[] = [
        "accepted",
        "running",
        "succeeded",
        "failed",
        "interrupted",
        "skipped",
      ];
      const status = String(args.status ?? "");
      if (!statuses.includes(status)) {
        throw new Error(`Invalid run status: ${status}`);
      }
      scheduleStore.setStatus(
        wireArg(args, "run_id", "runId"),
        status as Parameters<typeof scheduleStore.setStatus>[1],
      );
      return {};
    },
  };

  // --- settings page (vendored 1:1 from lumo-desktop webview/static) ---
  const settingsDir = resolveProjectPath("dist/webapp/settings");
  const settingsMime: Record<string, string> = {
    ".css": "text/css",
    ".js": "application/javascript",
    ".html": "text/html",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };

  // theme.js invokes the transport synchronously from <head>: the polyfill
  // must come first, so no defer on this tag.
  const injectSettingsTransport = (html: string): string =>
    insertAfterHead(html, '<script src="scripts/settings-inject.js"></script>');

  const serveSettingsFile = async (
    relPath: string,
    res: import("express").Response,
  ): Promise<void> => {
    const absPath = pathResolve(settingsDir, relPath);
    if (!absPath.startsWith(`${settingsDir}/`)) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    try {
      if (relPath === "settings.html" || relPath === "index.html") {
        const html = await readFile(absPath, "utf8");
        res.type("text/html").send(injectSettingsTransport(html));
        return;
      }
      const data = await readFile(absPath);
      const ext = relPath.slice(relPath.lastIndexOf("."));
      res.type(settingsMime[ext] ?? "application/octet-stream").send(data);
    } catch {
      res.status(404).type("text/plain").send("Not found");
    }
  };

  // Root redirect keeps the page's relative asset URLs (styles/, scripts/)
  // resolving against /lumo-bridge/settings/; Express matches /settings
  // with optional trailing slash, hence the explicit check. The wildcard
  // route does not match an empty rest path, so serve the page here.
  // Temporarily disabled: most of this page controls desktop-only
  // affordances (autostart, shortcuts, OS notifications) that do nothing
  // behind the proxy. Kept compilable for when Proton ships features here
  // worth exposing; flip the flag to bring the routes back.
  const settingsPageEnabled = false;
  if (settingsPageEnabled) {
    router.get("/settings", (req, res) => {
      if (!req.path.endsWith("/")) {
        res.redirect(BRIDGE_SETTINGS_PATH);
        return;
      }
      void serveSettingsFile("settings.html", res);
    });
    router.get("/settings/*rel", async (req, res) => {
      const rel = (req.params as unknown as Record<string, string | string[]>)
        .rel;
      await serveSettingsFile(
        (Array.isArray(rel) ? rel.join("/") : rel) || "settings.html",
        res,
      );
    });
  }

  // The vendored bundles must exist before the web app boots so its first
  // isDesktopEnvironment() check sees the transport.
  router.get(BRIDGE_INJECT_ROUTE, async (_req, res) => {
    try {
      const bundle = await readFile(
        resolveProjectPath("dist/webapp/lumo-inject.js"),
        "utf8",
      );
      // The HTML cache-busts this via ?v=, but a stale intermediate proxy
      // or memory cache must never pin an old injector either.
      res
        .setHeader("Cache-Control", "no-store")
        .type("application/javascript")
        .send(bundle);
    } catch {
      res
        .status(503)
        .type("text/plain")
        .send("webapp injector missing — run npm run build");
    }
  });

  // Tauri event stream: upstream event names and payload shapes only.
  router.get("/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(":\n\n");
    const client: SseClient = {
      send: (event, data) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    };
    bridge.addClient(client);
    for (const request of bridge.sync().pendingApprovals()) {
      client.send(EVT_APPROVAL_REQUEST, approvalRequestPayload(request));
    }
    const heartbeat = setInterval(() => res.write(":\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      bridge.removeClient(client);
    });
  });

  // Browser diagnostics from the injected client-log hook.
  router.post("/client-log", (req, res) => {
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as { message?: unknown })
        : {};
    const message = String(body.message ?? "").slice(0, 2000);
    if (message) {
      logger.debug({ source: "browser" }, message);
    }
    res.json({});
  });

  router.post("/invoke", (req, res) => {
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as { cmd?: unknown; args?: Record<string, unknown> })
        : {};
    const handler = commands[String(body.cmd ?? "")];
    if (!handler) {
      // Upstream adds commands faster than we implement them; a silent 404
      // would hide a needed refresh behind a browser-console-only error.
      logger.warn(
        { cmd: body.cmd },
        "bridge: unknown tauri command — check for an upstream refresh",
      );
      res.status(404).type("text/plain").send(`Unknown command`);
      return;
    }
    new Promise<unknown>((resolve) => resolve(handler(body.args ?? {}))).then(
      (result) => res.json(result ?? {}),
      (error: unknown) => {
        // Rust commands return Err(String); the vendored bridges surface
        // the message to the web app as-is.
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ cmd: body.cmd, error: message }, "bridge command failed");
        res.status(400).type("text/plain").send(message);
      },
    );
  });

  return router;
}
