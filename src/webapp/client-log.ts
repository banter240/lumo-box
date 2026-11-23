/**
 * Tamer-owned diagnostics: forwards browser console errors and unhandled
 * rejections to the server log. The hosted app swallows most failures
 * behind generic toasts; this surfaces the real cause.
 */
import { BRIDGE_CLIENT_LOG_PATH } from "./bridge-constants.js";

(function () {
  "use strict";
  const ENDPOINT = BRIDGE_CLIENT_LOG_PATH;
  const seen = new Set<string>();

  function fmt(part: unknown): string {
    if (part instanceof Error) {
      return `${part.name}: ${part.message}`;
    }
    if (typeof part === "object" && part !== null) {
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    }
    return String(part);
  }

  function post(parts: unknown[]): void {
    const msg = parts.map(fmt).join(" ").slice(0, 2000);
    if (!msg || seen.has(msg)) return;
    seen.add(msg);
    try {
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg }),
        keepalive: true,
      });
    } catch {
      /* diagnostics must never break the page */
    }
  }

  const rawError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    post(args);
    rawError(...args);
  };
  window.addEventListener("error", (e) => post([e.message]));
  window.addEventListener("unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    post([`Unhandled rejection: ${fmt(reason)}`]);
  });
})();
