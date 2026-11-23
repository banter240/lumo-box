/**
 * The Tauri invoke entry point, resolved once for every bundled script.
 *
 * `__TAURI_INTERNALS__` is the current API; `__TAURI__.core` is the `withGlobalTauri` surface and
 * exists as a fallback. Rejects rather than throwing when neither is present, so a caller outside a
 * Tauri webview gets a rejected promise instead of a synchronous exception.
 *
 * Account stamping is deliberately not here. `bridges/connectors.ts` wraps this with `withAccount`
 * for the commands that need it; the settings page and the login window must stay unstamped.
 */
export function tauriInvoke<T = unknown>(command: string, args?: TauriInvokeArgs): Promise<T> {
  if (window.__TAURI_INTERNALS__?.invoke) {
    return window.__TAURI_INTERNALS__.invoke<T>(command, args);
  }
  if (window.__TAURI__?.core?.invoke) {
    return window.__TAURI__.core.invoke<T>(command, args);
  }
  return Promise.reject(new Error('Tauri invoke API not available'));
}
