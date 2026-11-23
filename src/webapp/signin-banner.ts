/**
 * Tamer-owned addition to the injector: sign-in pill for the proxied app.
 * The app's own login button cannot work behind the proxy (its redirect
 * returns to the real lumo origin), so the fork sign-in route is the
 * supported path. Shown only when the SERVER session is dead; the app
 * may still look logged in — its own cookies outlive a server refresh
 * failure, and a logged-in app will not redeem a fork, so restoring is
 * a manual, user-paced step (sign out of the app first or just sign in).
 */

(function () {
  "use strict";

  /** Server replied; false means the live in-memory session is gone. */
  async function sessionMissing(): Promise<boolean> {
    try {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) return false;
      const signedIn = await invoke<boolean>("is_account_signed_in");
      return signedIn === false;
    } catch {
      return false;
    }
  }

  function onLoginPath(): boolean {
    // The app may be redeeming a fork right now; navigating aborts it.
    return window.location.pathname.startsWith("/login");
  }

  function showPill(text: string): void {
    if (onLoginPath()) return;
    if (document.getElementById("tamer-signin")) return;
    const bar = document.createElement("div");
    bar.id = "tamer-signin";
    bar.setAttribute(
      "style",
      [
        "position:fixed",
        "top:0",
        "left:50%",
        "transform:translateX(-50%)",
        "z-index:2147483647",
        "padding:.5rem 1rem",
        "margin-top:.5rem",
        "border-radius:999px",
        "background:#6d4aff",
        "color:#fff",
        "font:600 14px system-ui,sans-serif",
        "box-shadow:0 2px 12px rgba(0,0,0,.35)",
        "cursor:pointer",
      ].join(";"),
    );
    bar.textContent = text;
    bar.addEventListener("click", () => {
      window.location.href = "/webapp-signin/start";
    });

    const add = () => document.body?.appendChild(bar);
    if (document.body) add();
    else document.addEventListener("DOMContentLoaded", add, { once: true });
  }

  function evaluate(): void {
    void sessionMissing().then((missing) => {
      if (missing) showPill("Sign in with Proton");
    });
  }

  evaluate();

  // SPA navigations re-check; the pill guard keeps duplicates away.
  const recheck = () => {
    if (!onLoginPath()) evaluate();
  };
  for (const type of ["pushState", "replaceState"] as const) {
    const original = history[type].bind(history);
    history[type] = (...args: Parameters<typeof history.pushState>) => {
      const result = original(...args);
      recheck();
      return result;
    };
  }
  window.addEventListener("popstate", recheck);
})();
