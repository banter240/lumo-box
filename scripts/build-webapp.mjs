#!/usr/bin/env node
/**
 * Bundles the desktop-emulation injector for proxied Lumo pages.
 * Output: dist/webapp/lumo-inject.js (single IIFE, no imports).
 */

import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webviewSrc = join(root, "packages", "lumo-webview", "src");

mkdirSync(join(root, "dist", "webapp"), { recursive: true });
await build({
  entryPoints: [join(root, "src", "webapp", "lumo-inject.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: join(root, "dist", "webapp", "lumo-inject.js"),
  alias: {
    "@tauri-apps/plugin-log": join(root, "src", "webapp", "log-plugin.ts"),
    "@lumo-webview/src": join(root, "packages", "lumo-webview", "src"),
  },
  minify: true,
  logLevel: "silent",
});
console.log("webapp injector bundled -> dist/webapp/lumo-inject.js");

// Settings page, laid out like the desktop's src-tauri/dist: settings.html at
// the root, styles/ and images/ copied verbatim, JS entries bundled into scripts/.
const settingsOut = join(root, "dist", "webapp", "settings");
rmSync(settingsOut, { recursive: true, force: true });
mkdirSync(join(settingsOut, "scripts"), { recursive: true });
cpSync(join(webviewSrc, "static"), settingsOut, { recursive: true });
await build({
  entryPoints: [
    { in: join(webviewSrc, "pages", "settings", "index.js"), out: "settings" },
    { in: join(webviewSrc, "pages", "theme.ts"), out: "theme" },
  ],
  bundle: true,
  format: "iife",
  target: "es2020",
  outdir: join(settingsOut, "scripts"),
  alias: {
    "@tauri-apps/plugin-log": join(root, "src", "webapp", "log-plugin.ts"),
    "@lumo-webview/src": webviewSrc,
  },
  minify: true,
  logLevel: "silent",
});
await build({
  entryPoints: [join(root, "src", "webapp", "settings-page-inject.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: join(settingsOut, "scripts", "settings-inject.js"),
  minify: true,
  logLevel: "silent",
});
console.log("settings page bundled -> dist/webapp/settings");
