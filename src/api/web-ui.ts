/**
 * Shared HTML shell for /auth, /config, and /logs.
 * Colors follow Proton's public site: purple CTA, light canvas, tight cards.
 * Theme is stored in localStorage (`lumo-tamer-theme`); first visit follows the OS.
 */

import { NAV_MOUNT_JS, renderNavHost } from "../webapp/nav-shell.js";
import {
  BUILD_COMMIT,
  BUILD_AT,
  isBuildNewerThanProcess,
} from "../app/version.js";

const THEME_BOOT = `(function(){try{var t=localStorage.getItem('lumo-tamer-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;



const LOGOUT_BIND = `(function(){var btn=document.getElementById('logout');if(!btn)return;btn.addEventListener('click',function(){btn.disabled=true;btn.textContent='Signing out…';fetch('/auth/logout',{method:'POST'}).catch(function(){}).then(function(){location.href='/auth';});});})();`;



// Shared browser helpers: one toast implementation for all BIND scripts.
const WEB_HELPERS = `(function(){window.__ltToast=function(msg,ok){var c=document.getElementById('toast-container');if(!c)return;var el=document.createElement('div');el.className='toast '+(ok?'ok':'err');el.textContent=msg;el.title='Click to copy, then close';var gone=false;function bye(){if(gone)return;gone=true;el.style.opacity='0';el.style.transform='translateX(100%)';setTimeout(function(){el.remove();},300);}el.addEventListener('click',function(){try{navigator.clipboard.writeText(msg);}catch(e){}bye();});c.appendChild(el);if(ok)setTimeout(bye,4500);};})();`;











export const protonUiCss = `
:root {
  color-scheme: light;
  --purple: #6d4aff;
  --purple-hover: #5940d3;
  --purple-soft: #efeaff;
  --purple-soft-hover: #e4dcff;
  --bg: #f5f2ff;
  --card: #ffffff;
  --text: #1b1340;
  --muted: #5c5777;
  --line: #ddd7f2;
  --ok: #0f766e;
  --ok-soft: #d1fae5;
  --err: #c81e4a;
  --warn: #a16207;
  --input: #ffffff;
  --radius: 14px;
  --shadow: 0 18px 50px rgba(27, 19, 64, 0.08);
  --glow: radial-gradient(1200px 500px at 10% -10%, #e4dcff 0%, transparent 55%);
}
[data-theme="dark"] {
  color-scheme: dark;
  --purple: #8b7cff;
  --purple-hover: #a396ff;
  --purple-soft: rgba(139, 124, 255, 0.18);
  --purple-soft-hover: rgba(139, 124, 255, 0.3);
  --bg: #14121b;
  --card: #1d1a26;
  --text: #f2effa;
  --muted: #a39eb8;
  --line: #3b364a;
  --ok: #2dd4bf;
  --ok-soft: rgba(45, 212, 191, 0.16);
  --err: #fb7185;
  --warn: #fbbf24;
  --input: #15131c;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  --glow: radial-gradient(900px 420px at 12% -8%, rgba(109, 74, 255, 0.28) 0%, transparent 55%);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
html { scrollbar-gutter: stable; }
body {
  /* Local fonts only: no request to Google Fonts (it would leak the viewer's IP). */
  font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--glow), var(--bg);
  background-attachment: fixed;
  color: var(--text);
  line-height: 1.45;
}
a { color: var(--purple); text-decoration: none; font-weight: 600; }
a:hover { text-decoration: underline; }
.shell { width: min(74rem, calc(100% - 2rem)); margin: 3rem auto 4rem; }
.wrap { width: min(var(--page-width, 26rem), 100%); margin-inline: auto; }
.brand { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 1.25rem; }
.brand-home { display: flex; align-items: center; gap: 0.7rem; min-width: 0; color: inherit; font-weight: inherit; text-decoration: none; }
.brand-home:hover { text-decoration: none; color: inherit; }
.mark {
  width: 2.25rem; height: 2.25rem; border-radius: 10px; flex: none;
  background: linear-gradient(145deg, #8b74ff, #6d4aff);
  color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 1rem;
  box-shadow: 0 8px 18px rgba(109, 74, 255, 0.28);
}
.brand h1 { font-size: 1.15rem; margin: 0; letter-spacing: -0.02em; }
.brand p { margin: 0; color: var(--muted); font-size: 0.82rem; font-weight: 500; }
.brand-actions { margin-left: auto; display: flex; gap: 0.4rem; align-items: center; position: relative; }
.theme-btn, .icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 2.25rem; height: 2.25rem; padding: 0; flex: none;
  border-radius: 10px; border: 1px solid var(--line);
  background: var(--card); color: var(--text);
  box-shadow: none; text-decoration: none;
}
.theme-btn:hover, .icon-btn:hover { background: var(--purple-soft); color: var(--purple); }
a.icon-btn.current { background: var(--purple-soft); color: var(--purple); }
.card {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 1.35rem 1.4rem 1.5rem;
}
.lede { margin: 0 0 1rem; color: var(--muted); font-size: 0.92rem; }
.nav { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.85rem; margin: 0 0 1rem; }
label { display: block; margin: 0.85rem 0 0.3rem; font-size: 0.82rem; font-weight: 600; }
input[type=text], input[type=email], input[type=number], input[type=password], input[type=search], textarea, select {
  width: 100%; padding: 0.7rem 0.8rem; border-radius: 10px; border: 1px solid var(--line);
  background: var(--input); color: inherit; font: inherit;
}
input:focus, textarea:focus, select:focus {
  outline: 2px solid var(--purple-soft); border-color: var(--purple);
}
textarea { min-height: 5rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; }
textarea.tall { min-height: 12rem; }
input[type=checkbox] { width: 1.1rem; height: 1.1rem; accent-color: var(--purple); }
button, .btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.7rem 1.1rem; border: 0; border-radius: 999px;
  background: var(--purple); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
button.secondary { background: var(--purple-soft); color: var(--purple); }
button.secondary:hover { background: var(--purple-soft-hover); }
button:hover, .btn:hover { background: var(--purple-hover); }
button:disabled { opacity: 0.55; cursor: not-allowed; }
.ok { color: var(--ok); }
.err { color: var(--err); }
.hint, .muted { color: var(--muted); font-size: 0.85rem; line-height: 1.45; }
.hint { margin: 1rem 0 0; }
code { font-size: 0.84em; background: var(--purple-soft); padding: 0.05rem 0.3rem; border-radius: 6px; }
button.update-chip, button.auth-chip {
  display: inline-flex; align-items: center; flex: none;
  height: 2.25rem; margin: 0; padding: 0 0.75rem;
  border-radius: 999px; border: 1px solid var(--line);
  background: var(--card); color: var(--muted);
  font-size: 0.75rem; font-weight: 650; letter-spacing: 0.01em;
  cursor: pointer; box-shadow: none;
}
button.update-chip:hover, button.auth-chip:hover { background: var(--purple-soft); color: var(--purple); border-color: transparent; }
button.update-chip.ready, button.auth-chip.ready { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
button.update-chip.ready:hover, button.auth-chip.ready:hover { background: var(--ok); color: #fff; }
button.auth-chip.err { background: var(--err); color: #fff; border-color: transparent; }
button.update-chip:disabled, button.auth-chip:disabled { opacity: 0.55; cursor: not-allowed; }
#toast-container {
  position: fixed; top: 1rem; right: 1rem; z-index: 1000;
  display: flex; flex-direction: column; gap: 0.5rem;
  pointer-events: none;
}
.toast {
  padding: 0.75rem 1rem; background: var(--card); border: 1px solid var(--line);
  border-left: 4px solid var(--purple); border-radius: 6px;
  box-shadow: var(--shadow); font-size: 0.85rem; color: var(--text);
  animation: toastIn 0.3s ease; min-width: 200px; max-width: 34rem;
  word-break: break-word; overflow-wrap: anywhere;
  cursor: pointer; user-select: none;
  pointer-events: auto;
}
.toast.err {
  border-left-color: var(--err);
  /* Error toasts carry details worth copying; JS keeps them until clicked. */
}
.toast.ok { border-left-color: var(--ok); }
.toast.err { border-left-color: var(--err); }
.toast.muted { border-left-color: var(--muted); }
@keyframes toastIn {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
`;

// Layout shift for the tamer pages: padding here, margins in the app
// bundle (nav-rail.ts) — the bar itself is a shadow DOM owned by
// nav-shell.ts, only the host div is page-visible.
const NAV_HOST_CSS = `
body { padding-left: 52px; }
body.tamer-nav-expanded { padding-left: 200px; }
@media (max-width: 640px) { #tamer-nav-host { display: none; } body { padding-left: 0; } }
`;

export function htmlPage(options: {
  title: string;
  body: string;
  wide?: boolean;
  extraCss?: string;
  page: "auth" | "config" | "logs";
  version?: string;
  /** Served to this machine: the UI-lock button is meaningless (loopback
   *  is trusted without a key), so it is not rendered at all. */
  localUi?: boolean;
}): string {
  const width = options.wide ? "74rem" : "26rem";
  const verTag = options.version
    ? ` <span class="ver">v${options.version}</span>`
    : "";
  const buildTag =
    BUILD_COMMIT !== "unknown"
      ? ` <span class="ver build-tag" title="Built ${BUILD_AT ?? "unknown"}${isBuildNewerThanProcess() ? " — dist was rebuilt AFTER this process started: restart to serve it" : ""}">@${BUILD_COMMIT}${isBuildNewerThanProcess() ? " · stale" : ""}</span>`
      : "";
  const verCss =
    ".ver { color: var(--muted); font-size: 0.72rem; font-weight: 600; opacity: 0.8; }" +
    ".build-tag.stale { color: var(--warn); opacity: 1; }";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${options.title}</title>
  <script>${THEME_BOOT}</script>
  <style>:root { --page-width: ${width}; }${protonUiCss}${verCss}${NAV_HOST_CSS}${options.extraCss ?? ""}</style>
</head>
<body>
  ${renderNavHost(options.page, options.localUi)}
  <div class="shell">
    <div class="brand">
      <a class="brand-home" href="/auth">
        <div class="mark">L</div>
        <div>
          <h1>lumo-tamer</h1>
          <p>Unofficial Proton Lumo proxy${verTag}${buildTag}</p>
        </div>
      </a>

    </div>
    <div class="wrap">
    ${options.body}
    </div>
  </div>
  <div id="toast-container" aria-live="polite"></div>
  <script>${WEB_HELPERS}${NAV_MOUNT_JS}${LOGOUT_BIND}</script>
</body>
</html>`;
}
