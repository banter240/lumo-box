/**
 * esbuild alias target for the vendored webview's `@tauri-apps/plugin-log`
 * import (packages/lumo-webview/src/shared/logger.ts). Console only: there
 * is no Rust log file to forward to outside the desktop shell. The plugin
 * API is (message: string) => Promise<void>; callers pre-render their args.
 */

function sink(
  level: "debug" | "error" | "info" | "warn",
  message: string,
): Promise<void> {
  console[level](message);
  return Promise.resolve();
}

export const debug = (message: string): Promise<void> => sink("debug", message);
export const error = (message: string): Promise<void> => sink("error", message);
export const info = (message: string): Promise<void> => sink("info", message);
export const warn = (message: string): Promise<void> => sink("warn", message);
