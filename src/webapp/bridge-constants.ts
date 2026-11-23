/**
 * Shared constants between the tamer server and the browser bundle.
 * Dependency-free on purpose: server code and the esbuild injector both
 * import this, so the bridge location is defined exactly once.
 */
export const BRIDGE_PREFIX = "lumo-bridge";
export const BRIDGE_INVOKE_PATH = `/${BRIDGE_PREFIX}/invoke`;
export const BRIDGE_EVENTS_PATH = `/${BRIDGE_PREFIX}/events`;
export const BRIDGE_INJECT_PATH = `/${BRIDGE_PREFIX}/inject.js`;
export const BRIDGE_SETTINGS_PATH = `/${BRIDGE_PREFIX}/settings/`;
export const BRIDGE_CLIENT_LOG_PATH = `/${BRIDGE_PREFIX}/client-log`;
/** Route as registered inside the mounted bridge router. */
export const BRIDGE_INJECT_ROUTE = "/inject.js";
export const BRIDGE_SETTINGS_ROUTE = "/settings/";
export const BRIDGE_CLIENT_LOG_ROUTE = "/client-log";

/** Desktop IPC event names crossing the server/browser boundary; a typo
 * on either side silently breaks the flow, hence the shared constants. */
export const EVT_WORK_AVAILABLE = "schedules:work_available";
export const EVT_WEB_THEME_CHANGED = "web-theme:changed";
export const EVT_APPROVAL_REQUEST = "tool:approval_request";
export const EVT_APPROVAL_RESOLVED = "tool:approval_resolved";
export const EVT_SHOW_SETTINGS_TAB = "settings:show-tab";
