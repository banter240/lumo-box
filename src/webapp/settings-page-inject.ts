/**
 * Injected into the served settings page. Transport polyfill plus the
 * page-level emulations: close_settings_window has no native window here,
 * and pick_directory must browse the SERVER filesystem, so a modal
 * directory browser backed by tamer_list_directory serves it.
 */
import "./tauri-transport.js";

(function () {
  "use strict";
  const internals = window.__TAURI_INTERNALS__;
  const rawInvoke = internals?.invoke?.bind(internals);
  if (!internals || !rawInvoke) return;
  const invokeFn = rawInvoke as <T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;

  function wrappedInvoke<T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    if (cmd === "close_settings_window") {
      history.back();
      return Promise.resolve({} as T);
    }
    if (cmd === "pick_directory") {
      return pickServerDirectory() as Promise<T>;
    }
    return invokeFn<T>(cmd, args);
  }

  interface DirListing {
    path: string;
    parent: string | null;
    entries: { name: string; path: string }[];
  }

  function pickServerDirectory(): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.id = "tamer-dir-picker-overlay";
      overlay.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;" +
        "display:flex;align-items:center;justify-content:center;";
      const box = document.createElement("div");
      box.style.cssText =
        "background:var(--bg-primary,#fff);color:var(--text-primary,#111);" +
        "border-radius:10px;padding:18px;width:min(560px,90vw);" +
        "max-height:75vh;display:flex;flex-direction:column;gap:10px;";
      const title = document.createElement("div");
      title.textContent = "Select folder on the server";
      title.style.cssText = "font-weight:600;font-size:15px;";
      const pathBar = document.createElement("code");
      pathBar.style.cssText =
        "font-size:12px;opacity:.75;word-break:break-all;display:block;";
      const list = document.createElement("div");
      list.style.cssText =
        "overflow-y:auto;flex:1;border:1px solid rgba(128,128,128,.35);" +
        "border-radius:8px;min-height:180px;";
      const rowBtn = document.createElement("button");
      rowBtn.textContent = "Choose current folder";
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
      actions.append(cancel, rowBtn);
      box.append(title, pathBar, list, actions);
      overlay.append(box);
      document.body.append(overlay);

      const close = (value: string | null) => {
        overlay.remove();
        resolve(value);
      };
      cancel.onclick = () => close(null);

      let current = "";
      async function show(path: string) {
        let data: DirListing;
        try {
          data = (await invokeFn<DirListing>("tamer_list_directory", {
            path,
          })) as DirListing;
        } catch (e) {
          pathBar.textContent = String(e);
          return;
        }
        current = data.path;
        pathBar.textContent = data.path;
        list.textContent = "";
        const enter = (label: string, target: string) => {
          const row = document.createElement("div");
          row.textContent = label;
          row.style.cssText = "padding:6px 10px;cursor:pointer;font-size:13px;";
          row.onmouseenter = () =>
            (row.style.background = "rgba(128,128,128,.2)");
          row.onmouseleave = () => (row.style.background = "transparent");
          row.onclick = () => void show(target);
          list.append(row);
        };
        if (data.parent) enter("../", data.parent);
        for (const entry of data.entries) {
          enter(`\uD83D\uDCC1 ${entry.name}`, entry.path);
        }
        if (data.entries.length === 0) {
          const empty = document.createElement("div");
          empty.textContent = "(no subfolders)";
          empty.style.cssText = "padding:6px 10px;opacity:.6;font-size:13px;";
          list.append(empty);
        }
      }
      rowBtn.onclick = () => close(current);
      void show("");
    });
  }

  internals.invoke = wrappedInvoke;
  window.__TAURI__ = {
    core: { invoke: wrappedInvoke },
    event: internals.event,
  };
})();
