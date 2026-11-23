/**
 * Console logging that also reaches the Rust log file.
 *
 * The plugin resolves `__TAURI_INTERNALS__` at call time and rejects outside a Tauri webview, so
 * every forward is swallowed: a log line must never break its caller. The console call always
 * happens, which keeps devtools working in the browser build.
 *
 * Rust records these under the `webview` target, so the `[Lumo account]`-style prefixes the
 * callers already carry are what distinguishes one script from another in the log file.
 */
import { debug, error, info, warn } from '@tauri-apps/plugin-log';

function render(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function forwarding(
  forward: (message: string) => Promise<void>,
  toConsole: (...args: unknown[]) => void
) {
  return (...args: unknown[]): void => {
    toConsole(...args);
    try {
      void forward(render(args)).catch(() => {});
    } catch {
      // A webview without the IPC bridge still got the console call above.
    }
  };
}

export const logError = forwarding(error, console.error.bind(console));
export const logWarn = forwarding(warn, console.warn.bind(console));
export const logInfo = forwarding(info, console.info.bind(console));
export const logDebug = forwarding(debug, console.debug.bind(console));
