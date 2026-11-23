/**
 * Sign-in pill for the proxied app. The app's own login button cannot
 * work behind the proxy (its redirect returns to the real lumo origin),
 * so the fork sign-in route is the supported path.
 *
 * Self-heal: a guest shell with a LIVE server session (classic case:
 * /auth login while the webapp was disabled) auto-navigates to
 * /webapp-signin/auto, which mints the fork from the server session.
 * Heals are throttled to one per HEAL_THROTTLE_MS: a FAILED redemption
 * bounces through non-guest routes we cannot distinguish from success,
 * so a fresh guard would loop guest→auto forever. After the window the
 * pill shows (and a later guest landing heals again).
 */

(function () {
  "use strict";

  const HEAL_THROTTLE_MS = 60_000;
  const HEAL_KEY = "box-guest-heal-at";

  /** True when the bridge reports a live server session. */
  async function serverSignedIn(): Promise<boolean> {
    try {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) return false;
      return (await invoke<boolean>("is_account_signed_in")) === true;
    } catch {
      return false;
    }
  }

  function healedRecently(): boolean {
    try {
      const at = Number(sessionStorage.getItem(HEAL_KEY));
      return Number.isFinite(at) && Date.now() - at < HEAL_THROTTLE_MS;
    } catch {
      return false;
    }
  }

  function autoHeal(): void {
    try {
      sessionStorage.setItem(HEAL_KEY, String(Date.now()));
    } catch {}
    window.location.href = "/webapp-signin/auto";
  }

  function evaluate(): void {
    void (async () => {
      if (onLoginPath()) return;
      const inGuest = window.location.pathname.startsWith("/guest");
      const signedIn = await serverSignedIn();
      if (!signedIn) {
        showPill("Sign in with Proton");
        return;
      }
      if (inGuest && !healedRecently()) {
        autoHeal();
        return;
      }
      if (inGuest) showPill("Sign in with Proton");
    })();
  }

  function onLoginPath(): boolean {
    // The app may be redeeming a fork right now; navigating aborts it.
    return window.location.pathname.startsWith("/login");
  }

  function showPill(text: string): void {
    if (onLoginPath()) return;
    if (document.getElementById("box-signin")) return;
    const bar = document.createElement("div");
    bar.id = "box-signin";
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
      window.location.href = "/webapp-signin/auto";
    });

    const add = () => document.body?.appendChild(bar);
    if (document.body) add();
    else document.addEventListener("DOMContentLoaded", add, { once: true });
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
