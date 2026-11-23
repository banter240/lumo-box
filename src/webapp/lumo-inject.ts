/**
 * Everything injected into proxied Lumo pages. Import order matters: the
 * transport polyfill must exist before the vendored bridges initialize.
 * Bridge logic itself is upstream code (packages/lumo-webview) and is
 * never modified here — updates land via scripts/upstream/sync-webview.sh.
 */
import "./tauri-transport.js";
import "./client-log.js";
import "./signin-banner.js";
import "./nav-rail.js";
// Temporarily disabled with the settings page itself (see lumo-bridge.ts):
// the tab listener navigated to a page whose remaining features are
// desktop-only. Flip back together with settingsPageEnabled.
// import "./settings-tab.js";
import "./notifications-shim.js";
import "@lumo-webview/src/bridges/download-feedback.js";
import "@lumo-webview/src/bridges/connectors.js";
import "@lumo-webview/src/bridges/schedules.js";
import "@lumo-webview/src/bridges/account-identity.js";
import "@lumo-webview/src/bridges/theme-reporter.js";
