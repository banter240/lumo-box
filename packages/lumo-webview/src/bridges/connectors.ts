/**
 * Lumo connector bridge — works in Tauri desktop (native IPC) and in the browser.
 *
 * Desktop: calls Rust ToolRegistry via Tauri invoke.
 * Browser: uses the Lumo gateway connector API when available, with a built-in
 *          browser.fetch fallback for same-origin / CORS-accessible URLs.
 *
 * Exposed as:
 *   window.LumoConnectors          — settings UI + general connector access
 *   window.__TAURI__.external_tools — OpenAI-format tools for LumoAPIClient (desktop)
 */
import type {
  BrowserFetchInput,
  BrowserFetchResult,
  ConnectorCatalog,
  ConnectorManifest,
  FlatApiTool,
  JsonSchemaObject,
  LumoConnectorsApi,
  NamespacedTool,
  NormalizedToolCall,
  OpenAITool,
  PdfExportOptions,
  PdfExportResult,
  SettingsTab,
  ScheduleToolContext,
  ScheduleExecutionInput,
  ToolApprovalRequestPayload,
  ToolCallOptions,
  ToolApprovalResolvedPayload,
  ToolCall,
  ToolDefinition,
  ToolPolicy,
  ToolResultMessage,
  ToolsChangedDetail,
} from '../types';
import {
  BUILTIN_CONNECTORS,
  CONNECTOR_CATEGORIES,
  getFeaturedMcpServers,
  SETTINGS_CONNECTOR_TAB_PREFIX,
  categoryOf,
} from '../shared/connector-catalog';
import { logWarn } from '../shared/logger';
import { tauriInvoke as rawInvoke } from '../shared/tauri';

/** SVG data embedded by build-webview; absent in standalone bridge harnesses. */
declare const __LUMO_CONNECTOR_ICONS__: Record<string, string>;
const connectorIcons = typeof __LUMO_CONNECTOR_ICONS__ === 'undefined' ? {} : __LUMO_CONNECTOR_ICONS__;

(function () {
  'use strict';

  const GATEWAY_API = window.LUMO_CONNECTOR_API || '/api/connectors';

  function isTauri(): boolean {
    return (
      typeof window.__TAURI_INTERNALS__ !== 'undefined' ||
      typeof window.__TAURI__ !== 'undefined'
    );
  }

  const ACCOUNT_SCOPED_COMMANDS = new Set([
    'get_tool_registry',
    'get_builtin_tools',
    'invoke_tool',
    'register_schedule_execution_context',
    'connect_connector',
    'disconnect_connector',
    'set_connector_enabled',
    'set_tool_policy',
  ]);

  function withAccount(command: string, args?: TauriInvokeArgs): TauriInvokeArgs | undefined {
    if (!ACCOUNT_SCOPED_COMMANDS.has(command)) return args;
    const userId = window.__lumoAccountIdentity?.resolve?.().userId;
    return userId ? { ...args, userId } : args;
  }

  function tauriInvoke<T = unknown>(command: string, args?: TauriInvokeArgs): Promise<T> {
    return rawInvoke<T>(command, withAccount(command, args));
  }

  async function gatewayFetch<T = unknown>(
    path: string,
    options?: RequestInit
  ): Promise<T | null> {
    const res = await fetch(`${GATEWAY_API}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Gateway error ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  /** Browser-only manifest when the gateway is not available yet. */
  const BROWSER_ONLY_MANIFEST: ConnectorManifest = {
    id: 'browser',
    display_name: 'Browser',
    version: '1.0.0',
    readiness: { state: 'ready' },
    status: { state: 'ready' },
    enabled: true,
    tools: [
      {
        name: 'fetch',
        description: 'Fetch a URL (subject to browser CORS restrictions).',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            format: { type: 'string', enum: ['text', 'html', 'json'], default: 'text' },
          },
          required: ['url'],
        },
      },
    ],
  };

  function isConnectorReady(manifest: ConnectorManifest): boolean {
    if (manifest.enabled === false) {
      return false;
    }
    return manifest.readiness?.state === 'ready';
  }

  function namespaceTools(manifests: ConnectorManifest[]): NamespacedTool[] {
    return manifests.flatMap((c) =>
      (c.tools || [])
        .filter((t) => t.policy !== 'disable')
        .map((t) => ({
          ...t,
          name: `${c.id}__${t.name}`,
          connector_id: c.id,
          tool_name: t.name,
        }))
    );
  }

  const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

  function normalizeParameters(schema: unknown): JsonSchemaObject {
    const base: JsonSchemaObject =
      schema && typeof schema === 'object'
        ? { ...(schema as JsonSchemaObject) }
        : { type: 'object', properties: {} };
    if (!base.type) {
      base.type = 'object';
    }
    if (!base.$schema) {
      base.$schema = JSON_SCHEMA_DRAFT;
    }
    if (!base.properties) {
      base.properties = {};
    }
    return base;
  }

  /** OpenAI Chat Completions tool shape for inference requests. */
  function toOpenAITool(tool: ToolDefinition): OpenAITool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: normalizeParameters(tool.input_schema),
      },
    };
  }

  function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map(toOpenAITool);
  }

  /** @deprecated Flat Lumo shape — prefer toOpenAITool for inference requests. */
  function toFlatApiTool(tool: ToolDefinition): FlatApiTool {
    const openAi = toOpenAITool(tool);
    return {
      name: openAi.function.name,
      description: openAi.function.description,
      parameters: openAi.function.parameters,
    };
  }

  function toFlatApiTools(tools: ToolDefinition[]): FlatApiTool[] {
    return tools.map(toFlatApiTool);
  }

  /**
   * Ensure a tool entry is OpenAI `{ type, function }` shape (accepts flat or nested).
   *
   * The declared parameter is narrower than the runtime guards, which also tolerate callers passing
   * something that is neither shape and return it untouched.
   */
  function ensureOpenAIToolShape(tool: OpenAITool | FlatApiTool): OpenAITool {
    if (!tool || typeof tool !== 'object') {
      return tool as OpenAITool;
    }
    const nested = tool as OpenAITool;
    if (nested.type === 'function' && nested.function) {
      return {
        type: 'function',
        function: {
          name: nested.function.name,
          description: nested.function.description || '',
          parameters: normalizeParameters(nested.function.parameters),
        },
      };
    }
    const flat = tool as FlatApiTool;
    if (flat.name && (flat.description !== undefined || flat.parameters !== undefined)) {
      return toOpenAITool({
        name: flat.name,
        description: flat.description || '',
        input_schema: flat.parameters,
      });
    }
    return tool as OpenAITool;
  }

  function stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const MAX_TEXT_CHARS = 100_000;

  function truncateText(text: string): string {
    if (text.length <= MAX_TEXT_CHARS) return text;
    return `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated: ${text.length} characters in page, showing first ${MAX_TEXT_CHARS}]`;
  }

  async function browserClientFetch(input: BrowserFetchInput): Promise<BrowserFetchResult> {
    const res = await fetch(input.url, { credentials: 'omit' });
    const raw = await res.text();
    const format = input.format || 'text';
    let content: unknown;
    if (format === 'html') {
      content = raw;
    } else if (format === 'json') {
      try {
        content = JSON.parse(raw);
      } catch {
        content = { raw };
      }
    } else {
      content = truncateText(stripHtml(raw));
    }
    return {
      url: input.url,
      status: res.status,
      content_type: res.headers.get('content-type') || '',
      format,
      content,
    };
  }

  let manifests: ConnectorManifest[] = [];
  let desktopFeatureFlags = { experimentalConnectors: false };
  let builtinTools: NamespacedTool[] = [];
  let nativeTools: NamespacedTool[] = [];
  let availableTools: NamespacedTool[] = [];
  let initPromise: Promise<void> | null = null;

  function refreshToolLists(): void {
    nativeTools = [...namespaceTools(manifests.filter((c) => c.enabled !== false)), ...builtinTools];
    availableTools = [...namespaceTools(manifests.filter(isConnectorReady)), ...builtinTools];
  }

  function emitToolsChanged(): void {
    const detail: ToolsChangedDetail = {
      manifests,
      nativeTools,
      availableTools,
      openaiTools: toOpenAITools(availableTools),
    };
    window.dispatchEvent(new CustomEvent('lumo:connectors-ready', { detail }));
    window.dispatchEvent(new CustomEvent('lumo:tools-changed', { detail }));
  }

  const MCP_ID_PREFIX = 'mcp-';

  function httpUrlOf(manifest: ConnectorManifest): string | undefined {
    const transport = manifest.auth?.type === 'mcp_server' ? manifest.auth.transport : undefined;
    if (!transport || typeof transport !== 'object') return undefined;
    const { transport: kind, url } = transport as { transport?: unknown; url?: unknown };
    return kind === 'http' && typeof url === 'string' ? url : undefined;
  }

  function describeManifest(manifest: ConnectorManifest): ConnectorManifest {
    return {
      ...manifest,
      category: categoryOf(manifest.id),
      server_id: manifest.id.startsWith(MCP_ID_PREFIX)
        ? manifest.id.slice(MCP_ID_PREFIX.length)
        : undefined,
      url: httpUrlOf(manifest),
    };
  }

  async function loadRegistry(): Promise<ConnectorManifest[]> {
    if (isTauri()) {
      const registry = await tauriInvoke<ConnectorManifest[]>('get_tool_registry');
      desktopFeatureFlags = await tauriInvoke<{ experimentalConnectors: boolean }>('get_desktop_feature_flags')
        .catch(() => ({ experimentalConnectors: false }));
      manifests = registry.map(describeManifest);
      const builtins = await tauriInvoke<ToolDefinition[]>('get_builtin_tools');
      builtinTools = builtins.map((tool) => {
        const { connectorId, toolName } = parseNamespaced(tool.name);
        return { ...tool, connector_id: connectorId, tool_name: toolName };
      });
    } else {
      builtinTools = [];
      const gatewayManifests = await gatewayFetch<ConnectorManifest[]>('/registry');
      manifests = (gatewayManifests || [BROWSER_ONLY_MANIFEST]).map(describeManifest);
    }
    refreshToolLists();
    emitToolsChanged();
    return manifests;
  }

  async function init(): Promise<void> {
    await loadRegistry();

    if (isTauri()) {
      const listen =
        window.__TAURI__?.event?.listen ||
        window.__TAURI_INTERNALS__?.event?.listen;
      if (listen) {
        await listen('connector:changed', () => loadRegistry());
        await listen('connectors:changed', () => loadRegistry());
        await listen('tool:approval_request', (event) => {
          const p = (event.payload || {}) as ToolApprovalRequestPayload;
          window.dispatchEvent(
            new CustomEvent('lumo:tool-approval-request', {
              detail: {
                requestId: p.request_id,
                connectorId: p.connector_id,
                toolName: p.tool_name,
                input: p.input,
                ...(p.reason ? { reason: p.reason } : {}),
              },
            })
          );
        });
        await listen('tool:approval_resolved', (event) => {
          const p = (event.payload || {}) as ToolApprovalResolvedPayload;
          window.dispatchEvent(
            new CustomEvent('lumo:tool-approval-resolved', {
              detail: {
                requestId: p.request_id,
                approved: p.approved,
              },
            })
          );
        });
      }
    }
  }

  function ensureInit(): Promise<void> {
    if (!initPromise) {
      initPromise = init().catch((err) => {
        initPromise = null;
        logWarn('[LumoConnectors] init failed:', err);
        throw err;
      });
    }
    return initPromise;
  }

  function getNativeTools(): NamespacedTool[] {
    return nativeTools;
  }

  /** Tools from connectors that are enabled and authenticated (safe to offer the model). */
  function getAvailableTools(): NamespacedTool[] {
    return availableTools;
  }

  function getManifests(): ConnectorManifest[] {
    return manifests;
  }

  function getConnectors(): ConnectorManifest[] {
    return manifests.filter((c) => c.readiness?.state === 'ready');
  }

  /** OpenAI Chat Completions `tools` array for inference requests. */
  function getOpenAITools(): OpenAITool[] {
    return toOpenAITools(availableTools);
  }

  /** @deprecated Prefer getOpenAITools. */
  function getFlatApiTools(): FlatApiTool[] {
    return toFlatApiTools(availableTools);
  }

  function isNativeTool(name: string): boolean {
    return nativeTools.some((t) => t.name === name);
  }

  function isAvailableTool(name: string): boolean {
    const aliases: Record<string, string> = {
      browser_fetch: 'browser__fetch',
      browser_navigate: 'browser__navigate',
    };
    const resolved = aliases[name] || name;
    return availableTools.some((t) => t.name === resolved);
  }

  function parseNamespaced(name: string): { connectorId: string; toolName: string } {
    const aliases: Record<string, string> = {
      browser_fetch: 'browser__fetch',
      browser_navigate: 'browser__navigate',
      filesystem_fs_read: 'filesystem__fs_read',
      filesystem_fs_search: 'filesystem__fs_search',
      filesystem_fs_write: 'filesystem__fs_write',
      filesystem_fs_edit: 'filesystem__fs_edit',
      bash_run: 'bash__run',
    };
    const resolved = aliases[name] || name;
    const sep = resolved.indexOf('__');
    if (sep === -1) {
      throw new Error(`Invalid native tool name: ${name}`);
    }
    return {
      connectorId: resolved.slice(0, sep),
      toolName: resolved.slice(sep + 2),
    };
  }

  function parseToolCallArguments(raw: unknown): Record<string, unknown> {
    if (raw == null || raw === '') {
      return {};
    }
    if (typeof raw === 'object') {
      return raw as Record<string, unknown>;
    }
    try {
      return JSON.parse(raw as string) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Invalid tool call arguments JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  function serializeToolResult(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  function serializeBoundedToolError(message: string): string {
    const maxBytes = 32_000;
    const notice = '\n[Tool error truncated; middle omitted.]\n';
    const serialized = serializeToolResult({ error: message });
    const encoder = new TextEncoder();
    if (encoder.encode(serialized).length <= maxBytes) {
      return serialized;
    }

    // Measure the JSON sent to the model: escaping can make it much larger than the error text.
    const characters = Array.from(message);
    let lower = 0;
    let upper = characters.length;
    let bounded = serializeToolResult({ error: notice });
    while (lower <= upper) {
      const count = Math.floor((lower + upper) / 2);
      const tailCount = Math.floor(count / 4);
      const head = characters.slice(0, count - tailCount).join('');
      const tail = characters.slice(characters.length - tailCount).join('');
      const candidate = serializeToolResult({ error: head + notice + tail });
      if (encoder.encode(candidate).length <= maxBytes) {
        bounded = candidate;
        lower = count + 1;
      } else {
        upper = count - 1;
      }
    }
    return bounded;
  }

  /**
   * Extract tool name + args from an OpenAI-style tool call object.
   * Supports Chat Completions (`function.name`) and flat `{ name, arguments }`.
   */
  function normalizeToolCall(toolCall: ToolCall): NormalizedToolCall {
    const fn = toolCall.function || toolCall;
    const name = fn.name || toolCall.name;
    if (!name) {
      throw new Error('Tool call is missing function name');
    }
    const args = parseToolCallArguments(fn.arguments ?? toolCall.arguments);
    const id = toolCall.id || toolCall.tool_call_id || null;
    return { id, name, arguments: args };
  }

  async function dispatchNativeTool(namespacedName: string, input: unknown, scheduleContext?: ScheduleToolContext, fileTransport = false, options?: ToolCallOptions): Promise<unknown> {
    const aliases: Record<string, string> = {
      browser_fetch: 'browser__fetch',
      browser_navigate: 'browser__navigate',
      filesystem_fs_read: 'filesystem__fs_read',
      filesystem_fs_search: 'filesystem__fs_search',
      filesystem_fs_write: 'filesystem__fs_write',
      filesystem_fs_edit: 'filesystem__fs_edit',
      bash_run: 'bash__run',
    };
    const resolvedName = aliases[namespacedName] || namespacedName;
    const { connectorId, toolName } = parseNamespaced(resolvedName);

    if (isTauri()) {
      return tauriInvoke('invoke_tool', {
        connectorId,
        toolName,
        input,
        fileTransport,
        ...(scheduleContext ? { scheduleContext } : {}),
        ...(options?.conversationId ? { conversationId: options.conversationId } : {}),
      });
    }

    if (scheduleContext) throw new Error('Scheduled tool execution requires Lumo Desktop.');

    const gatewayResult = await gatewayFetch('/invoke', {
      method: 'POST',
      body: JSON.stringify({ connector_id: connectorId, tool_name: toolName, input }),
    });
    if (gatewayResult !== null) {
      return gatewayResult;
    }

    if (connectorId === 'browser' && toolName === 'fetch') {
      return browserClientFetch(input as BrowserFetchInput);
    }

    throw new Error(
      `Connector "${connectorId}" is not available in the browser. Use Lumo Desktop or connect via the Lumo web settings.`
    );
  }

  /**
   * Execute one OpenAI-format tool call and return a tool result message payload.
   */
  async function executeToolCall(toolCall: ToolCall, scheduleContext?: ScheduleToolContext, options?: ToolCallOptions): Promise<ToolResultMessage> {
    const { id, name, arguments: args } = normalizeToolCall(toolCall);

    if (!isAvailableTool(name)) {
      return {
        role: 'tool',
        tool_call_id: id,
        name,
        content: serializeToolResult({
          error: `Native tool "${name}" is not available (connector may need setup)`,
        }),
        is_error: true,
      };
    }

    try {
      const output = await dispatchNativeTool(name, args, scheduleContext, true, options);
      // Only the native invocation response owns this marker. Connector content
      // and browser/gateway fallbacks cannot supply transport metadata.
      const envelope = isTauri() ? output as { value: unknown; file_transport?: boolean } : undefined;
      const result = envelope ? envelope.value : output;
      const fileTransfer = envelope?.file_transport === true ? result : undefined;
      return {
        role: 'tool',
        tool_call_id: id,
        name,
        content: fileTransfer === undefined ? serializeToolResult(result) : '[File conversion pending]',
        ...(fileTransfer === undefined ? {} : { fileTransfer }),
      };
    } catch (err) {
      return {
        role: 'tool',
        tool_call_id: id,
        name,
        content: serializeBoundedToolError((err instanceof Error && err.message) || String(err)),
        is_error: true,
      };
    }
  }

  /** Execute multiple tool calls (e.g. from one assistant turn). Runs in parallel. */
  async function executeToolCalls(toolCalls: ToolCall[], scheduleContext?: ScheduleToolContext, options?: ToolCallOptions): Promise<ToolResultMessage[]> {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [];
    }
    return Promise.all(toolCalls.map((call) => executeToolCall(call, scheduleContext, options)));
  }

  async function connectConnector(
    connectorId: string,
    credentials?: unknown
  ): Promise<unknown> {
    if (isTauri()) {
      return tauriInvoke('connect_connector', { connectorId, credentials });
    }
    const result = await gatewayFetch('/authenticate', {
      method: 'POST',
      body: JSON.stringify({ connector_id: connectorId, credentials }),
    });
    if (result === null) {
      throw new Error('Connector authentication requires the Lumo gateway or Lumo Desktop.');
    }
    await loadRegistry();
    return result;
  }

  async function setConnectorEnabled(connectorId: string, enabled: boolean): Promise<void> {
    if (isTauri()) {
      return tauriInvoke('set_connector_enabled', { connectorId, enabled });
    }
    throw new Error('Enabling or disabling connectors requires Lumo Desktop.');
  }

  async function setToolPolicy(
    connectorId: string,
    toolName: string,
    policy: ToolPolicy
  ): Promise<void> {
    if (isTauri()) {
      return tauriInvoke('set_tool_policy', { connectorId, toolName, policy });
    }
    throw new Error('Setting tool approval policy requires Lumo Desktop.');
  }

  async function respondToolApproval(
    requestId: string,
    approved: boolean,
    always = false
  ): Promise<void> {
    if (isTauri()) {
      return tauriInvoke('respond_tool_approval', { requestId, approved, always });
    }
    throw new Error('Responding to tool approvals requires Lumo Desktop.');
  }

  const CONNECTOR_ID = /^[a-z0-9_-]{1,64}$/;

  /** See `LumoConnectorsApi.exportPdf` and `src-tauri/src/pdf_export.rs`. */
  function exportPdf(html: string, options: PdfExportOptions): Promise<PdfExportResult> {
    return tauriInvoke<PdfExportResult>('export_pdf', {
      html,
      fileName: options.fileName,
      title: options.title ?? null,
    });
  }

  /**
   * @param tab Settings tab to land on ('general' | 'connectors'); omit for the last one shown.
   * @param connectorId Connector whose details to open; implies the connectors tab.
   */
  async function openSettings(tab?: SettingsTab, connectorId?: string): Promise<void> {
    if (!isTauri()) {
      throw new Error('Opening the settings page requires Lumo Desktop.');
    }
    if (connectorId !== undefined && !CONNECTOR_ID.test(connectorId)) {
      throw new Error('Invalid connector id.');
    }
    const target = connectorId ? `${SETTINGS_CONNECTOR_TAB_PREFIX}${connectorId}` : tab;
    return tauriInvoke('open_settings_window', { source: 'app-ui', tab: target ?? null });
  }

  /** Read the latest registry snapshot after `ready`, or after a tools-changed event. */
  function getCatalog(): ConnectorCatalog {
    const entries = new Map<string, ConnectorCatalog['connectors'][number]>(
      [...BUILTIN_CONNECTORS, ...getFeaturedMcpServers(desktopFeatureFlags.experimentalConnectors)]
        .map(
          ({ iconSrc, ...entry }) => [entry.id, { ...entry, icon: connectorIcons[iconSrc], registered: false, tools: [] }]
        )
    );
    for (const manifest of manifests) {
      const preset = entries.get(manifest.id);
      // Explicit projection: manifests can contain stdio env, arguments and other auth config.
      entries.set(manifest.id, {
        id: manifest.id,
        server_id: manifest.server_id,
        category: preset?.category ?? manifest.category ?? 'custom',
        icon: manifest.icon ?? preset?.icon,
        name: manifest.display_name,
        description: manifest.description ?? preset?.description ?? '',
        url: preset?.url,
        registered: true,
        enabled: manifest.enabled !== false,
        readiness: { ...manifest.readiness },
        status: { ...manifest.status },
        tools: (manifest.tools ?? []).map(({ name, title, description, read_only }) => ({
          name, title, description, read_only,
        })),
      });
    }
    return {
      categories: CONNECTOR_CATEGORIES.map((category) => ({ ...category })),
      connectors: [...entries.values()],
    };
  }

  async function disconnectConnector(connectorId: string): Promise<unknown> {
    if (isTauri()) {
      return tauriInvoke('disconnect_connector', { connectorId });
    }
    const result = await gatewayFetch('/disconnect', {
      method: 'POST',
      body: JSON.stringify({ connector_id: connectorId }),
    });
    if (result === null) {
      throw new Error('Connector disconnect requires the Lumo gateway or Lumo Desktop.');
    }
    await loadRegistry();
    return result;
  }

  async function registerScheduleExecutionContext(input: ScheduleExecutionInput): Promise<ScheduleToolContext> {
    if (!isTauri()) throw new Error('Scheduled tool execution requires Lumo Desktop.');
    return tauriInvoke<ScheduleToolContext>('register_schedule_execution_context', input);
  }

  const connectorApi: LumoConnectorsApi = {
    ready: ensureInit(),
    init,
    loadRegistry,
    async setFeatureFlags(flags) {
      if (!isTauri()) return;
      await connectorApi.ready;
      await tauriInvoke('set_desktop_feature_flags', { flags });
      await loadRegistry();
    },
    getNativeTools,
    getAvailableTools,
    getManifests,
    getConnectors,
    setConnectorEnabled,
    setToolPolicy,
    respondToolApproval,
    getFlatApiTools,
    getOpenAITools,
    toFlatApiTool,
    toFlatApiTools,
    toOpenAITool,
    toOpenAITools,
    ensureOpenAIToolShape,
    normalizeParameters,
    isNativeTool,
    isAvailableTool,
    dispatchNativeTool,
    executeToolCall,
    executeToolCalls,
    scheduleExecutionCapabilities: { readOnlyConnectors: isTauri() },
    registerScheduleExecutionContext,
    connectConnector,
    disconnectConnector,
    openSettings,
    getCatalog,
    ...(isTauri() && navigator.userAgent.includes('Mac OS X') ? { exportPdf } : {}),
    isDesktop: isTauri(),
    isBrowser: !isTauri(),
  };

  window.LumoConnectors = connectorApi;

  // LumoAPIClient discovers native tools here when running inside Lumo Desktop.
  if (isTauri()) {
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.external_tools = {
      ready: connectorApi.ready,
      getTools: getOpenAITools,
      getOpenAITools,
      getFlatApiTools,
      getAvailableTools,
      isNativeTool: isAvailableTool,
      executeToolCall,
      executeToolCalls,
      completeFileRead: (resultId: string, value: unknown) =>
        dispatchNativeTool('tool_results__complete_file', { result_id: resultId, value }),
      scheduleExecutionCapabilities: { readOnlyConnectors: true },
      registerScheduleExecutionContext,
    };
  }

  ensureInit();
})();
