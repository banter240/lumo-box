/**
 * Tauri IPC transport polyfill for proxied Lumo pages: the ONLY piece of
 * desktop emulation we own. Maps invoke() onto the tamer bridge HTTP
 * endpoint and event.listen() onto its SSE stream. Everything downstream
 * (window.LumoConnectors, LumoSchedules, account identity) is vendored
 * upstream code driving this transport unmodified.
 */

import { BRIDGE_EVENTS_PATH, BRIDGE_INVOKE_PATH } from "./bridge-constants.js";

(function () {
  "use strict";
  if (window.__TAURI_INTERNALS__) return;

  type Listener = (event: { event: string; payload?: unknown }) => void;

  async function invoke(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(BRIDGE_INVOKE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ cmd, args: args ?? {} }),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    throw new Error(text || "bridge invoke failed: " + res.status);
  }

  // One SSE stream; named events dispatch to per-name listeners, the same
  // routing Tauri's event plugin does natively.
  const source = new EventSource(BRIDGE_EVENTS_PATH);
  const listeners = new Map<string, Listener[]>();

  function listen(name: string, handler: Listener): Promise<() => void> {
    let entry = listeners.get(name);
    if (!entry) {
      entry = [];
      listeners.set(name, entry);
      source.addEventListener(name, (ev) => {
        let payload: unknown;
        try {
          payload = ev.data ? JSON.parse(ev.data) : undefined;
        } catch {
          return;
        }
        for (const handler of entry!) {
          try {
            handler({ event: name, payload });
          } catch (error) {
            console.warn("[lumo-bridge] event handler failed", error);
          }
        }
      });
    }
    entry.push(handler);
    return Promise.resolve(() => {
      const list = listeners.get(name);
      if (!list) return;
      const at = list.indexOf(handler);
      if (at !== -1) list.splice(at, 1);
    });
  }

  const internals = {
    invoke: invoke as <T = unknown>(
      cmd: string,
      args?: Record<string, unknown>,
    ) => Promise<T>,
    event: { listen },
  };
  window.__TAURI_INTERNALS__ = internals;
  window.__TAURI__ = {
    core: { invoke: internals.invoke },
    event: { listen },
  };
})();
