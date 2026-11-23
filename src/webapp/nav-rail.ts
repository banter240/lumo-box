/**
 * Client-side host of the shared tamer sidebar (nav-shell.ts) inside
 * the proxied Lumo app: drops in the same host div and runs the same
 * mount script the tamer pages embed, so the bar is byte-identical on
 * both sides. Only the layout shift differs (margins here, padding on
 * the tamer pages).
 */

import { NAV_MOUNT_JS, renderWebappNavHost } from "./nav-shell.js";

(function () {
  "use strict";
  if (window.top !== window) return;

  // Layout shift for THIS host; the bar itself is styled inside its shadow.
  const APP_LAYOUT_CSS = `
    body { margin-left: 52px; transition: margin-left .16s ease; }
    body.tamer-nav-expanded { margin-left: 200px; }
    @media (max-width: 640px) { #tamer-nav-host { display: none; } body { margin-left: 0; } }
  `;

  const style = document.createElement("style");
  style.textContent = APP_LAYOUT_CSS;

  const host = document.createElement("div");
  host.innerHTML = renderWebappNavHost();
  const mount = document.createElement("script");
  mount.textContent = NAV_MOUNT_JS;

  const add = () => {
    document.head.append(style);
    document.body.append(host.firstElementChild!, mount);
  };
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add, { once: true });
})();
