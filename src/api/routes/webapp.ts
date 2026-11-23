/**
 * Lumo web app passthrough (experimental, webapp.enabled).
 *
 * Reverse proxy for the official Lumo web app, mounted as a catch-all AFTER
 * every tamer route. Anything reaching it belongs to the app: pages, assets,
 * and the app's own API calls (the browser's Proton session rides in cookies
 * and headers). U2L encryption runs client-side inside the page; the proxy
 * only moves bytes.
 *
 * The app is served from the root because its assets and redirects use
 * absolute paths. Upstream CSP headers are dropped: they are pinned to
 * lumo.proton.me and would break same-origin serving. SRI hashes on the
 * app's scripts stay valid since bodies pass through untouched.
 */

import type { Request, Response as ExpressResponse } from "express";
import { Router } from "express";
import { Readable } from "stream";
import { getWebappConfig } from "../../app/config.js";
import { captureChatBody } from "./wire-capture.js";
import { logger } from "../../app/logger.js";
import { insertAfterHead } from "../../webapp/head-inject.js";
import { BRIDGE_INJECT_PATH } from "../../webapp/bridge-constants.js";
import { BRIDGE_PREFIX } from "./lumo-bridge.js";
import { observeForkRedemption } from "./webapp-signin.js";

/** Tamer-owned web prefixes. Single source for BOTH the routing table
 * and the access-gate predicates below: adding an owned route must touch
 * exactly here, or the gate silently bypasses or swallows it. */
const BRIDGE_WEB_PREFIX = `/${BRIDGE_PREFIX}`;
const SIGNIN_WEB_PREFIX = "/webapp-signin";

/** Paths owned by tamer; when the webapp is on, everything else is proxied. */
const TAMER_PREFIXES = [
  "/v1",
  "/auth",
  "/config",
  "/health",
  "/metrics",
  "/logs",
  "/ui-login",
  "/ui-logout",
  SIGNIN_WEB_PREFIX,
  BRIDGE_WEB_PREFIX,
];

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Response headers never forwarded to the browser. */
const STRIP_RESPONSE = new Set([
  ...HOP_BY_HOP,
  "content-security-policy",
  "content-security-policy-report-only",
  // undici streams the decoded body; lengths and encodings no longer match
  "content-length",
  "content-encoding",
]);

/**
 * Rewrite an upstream Set-Cookie so the browser accepts it for OUR origin.
 * Upstream pins Domain=.proton.me (browsers drop it for any other host) and
 * marks sessions Secure (lost over plain-HTTP LAN); the app session must
 * live on this origin for the proxied app to stay logged in.
 */
export function sanitizeCookie(cookie: string): string {
  const parts = cookie.split(";");
  const kept = parts.filter((attr) => {
    const name = attr.split("=")[0]!.trim().toLowerCase();
    return name !== "domain" && name !== "secure";
  });
  return kept.join(";");
}

function hasPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

/** Pure decision: does this path belong to the proxied web app? */
export function isWebappCandidatePath(
  path: string,
  webappEnabled: boolean,
): boolean {
  if (!webappEnabled) return false;
  return !TAMER_PREFIXES.some((prefix) => hasPrefix(path, prefix));
}

/** Config-aware variant used by the middleware gates. */
export function isWebappRequestPath(path: string): boolean {
  try {
    return isWebappCandidatePath(path, getWebappConfig().enabled);
  } catch {
    return false;
  }
}

/** Bridge endpoints get the same machine-or-unlock gate as proxied pages. */
export function isBridgeRequestPath(path: string): boolean {
  try {
    if (!getWebappConfig().enabled) return false;
    return hasPrefix(path, BRIDGE_WEB_PREFIX);
  } catch {
    return false;
  }
}

/**
 * Tamer-owned routes that only exist to serve the proxied web app
 * (Proton fork sign-in). Same machine-or-unlock gate as the proxy.
 */
export function isWebappOwnedPath(path: string): boolean {
  try {
    return getWebappConfig().enabled && hasPrefix(path, SIGNIN_WEB_PREFIX);
  } catch {
    return false;
  }
}

function forwardRequestHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (name === "host" || name === "accept-encoding" || HOP_BY_HOP.has(name)) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  return headers;
}

/** Keep 3xx to our own origin on our origin; leave cross-domain ones alone. */
function rewriteLocation(
  location: string,
  upstreamOrigin: string,
  reqOrigin: string,
): string {
  try {
    const parsed = new URL(location, upstreamOrigin);
    if (parsed.origin === upstreamOrigin) {
      const suffix = parsed.pathname + parsed.search + parsed.hash;
      return suffix || "/";
    }
    return parsed.toString();
  } catch {
    return location;
  }
}

function injectInjectorScript(html: string, src: string): string {
  return insertAfterHead(html, `<script src="${src}" defer></script>`);
}

/** The app's fork redemption endpoint (consuming GET). */
const FORK_RE = /^\/api\/auth\/v4\/sessions\/forks\/([^/]+)$/;

/** The host the proxied app must run on: its SPA derives same-origin
 * URLs by rewriting the first hostname label (127.0.0.1 -> lumo.0.0.1,
 * lumo.lumo.localhost -> wrong origin), so navigations are held to this
 * one canonical host. */
const CANONICAL_WEBAPP_HOST = "lumo.localhost";

/** Redirect target for a navigation arriving on the wrong host, or undefined
 * when the host is already canonical or the request is not a navigation.
 * Pure: also used by the unit tests. */
export function webappCanonicalLocation(
  host: string | undefined,
  method: string,
  accept: string | undefined,
  originalUrl: string,
): string | undefined {
  if (!host) return undefined;
  const colon = host.indexOf(":");
  const hostname = colon === -1 ? host : host.slice(0, colon);
  if (hostname === CANONICAL_WEBAPP_HOST) return undefined;
  if (method !== "GET" || !(accept ?? "").includes("text/html")) {
    return undefined;
  }
  // The browser carries the request's #fragment over to a redirect target
  // without one, so /login#selector&sk redemptions survive the hop.
  const port = colon === -1 ? "" : host.slice(colon);
  return `http://${CANONICAL_WEBAPP_HOST}${port}${originalUrl}`;
}

function proxyHandler(upstream: string) {
  return async (req: Request, res: ExpressResponse): Promise<void> => {
    const canonical = webappCanonicalLocation(
      req.get("host"),
      req.method,
      req.headers.accept,
      req.originalUrl,
    );
    if (canonical) {
      res.redirect(302, canonical);
      return;
    }
    let target: URL;
    try {
      target = new URL(req.originalUrl, upstream);
    } catch {
      res.status(400).json({ error: "Invalid webapp proxy target" });
      return;
    }

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const init: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers: forwardRequestHeaders(req),
      redirect: "manual",
    };
    if (hasBody) {
      const captured = await captureChatBody(req.method, target.pathname, req);
      if (captured) {
        init.body = new Uint8Array(captured);
      } else {
        init.body = Readable.toWeb(req) as ReadableStream;
        init.duplex = "half";
      }
    }

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(target, init);
    } catch (error) {
      // undici reuses keep-alive sockets; a socket the upstream just closed
      // makes parallel fetches fail with a bare TypeError. One retry for
      // idempotent methods papers over that race.
      const cause = (error as { cause?: unknown }).cause;
      logger.warn(
        {
          error: String(error),
          cause: String(cause),
          method: req.method,
          path: target.pathname,
        },
        "webapp proxy: upstream unreachable (retrying GET)",
      );
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.status(502).type("text/plain").send("Lumo web app unreachable");
        return;
      }
      try {
        await new Promise((r) => setTimeout(r, 250));
        upstreamRes = await fetch(target, init);
      } catch (retryError) {
        const retryCause = (retryError as { cause?: unknown }).cause;
        logger.warn(
          {
            error: String(retryError),
            cause: String(retryCause),
            target: target.origin,
          },
          "webapp proxy: upstream unreachable after retry",
        );
        res.status(502).type("text/plain").send("Lumo web app unreachable");
        return;
      }
    }

    if (!upstreamRes.ok && upstreamRes.status !== 304) {
      logger.warn(
        {
          method: req.method,
          path: target.pathname,
          status: upstreamRes.status,
        },
        "webapp proxy: upstream non-2xx",
      );
    }

    res.status(upstreamRes.status);

    upstreamRes.headers.forEach((value, name) => {
      if (STRIP_RESPONSE.has(name) || name === "set-cookie") return;
      res.setHeader(name, value);
    });
    // Set-Cookie must survive as separate headers: it carries the app's
    // Proton session onto this origin. Sanitized, or the browser drops it.
    for (const cookie of upstreamRes.headers.getSetCookie()) {
      res.append("Set-Cookie", sanitizeCookie(cookie));
    }

    const location = upstreamRes.headers.get("location");
    if (upstreamRes.status >= 300 && upstreamRes.status < 400 && location) {
      try {
        const upstreamOrigin = new URL(upstream).origin;
        const proto = req.protocol || "http";
        const reqOrigin = `${proto}://${req.get("host") ?? ""}`;
        res.setHeader(
          "Location",
          rewriteLocation(location, upstreamOrigin, reqOrigin),
        );
      } catch {
        res.setHeader("Location", location);
      }
    }

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    // Sniff the app's fork redemption: the fork GET consumes the fork, so
    // this pass-through response is tamer's only look at the session.
    const contentType = upstreamRes.headers.get("content-type") ?? "";
    const forkMatch = FORK_RE.exec(target.pathname);
    if (forkMatch && upstreamRes.status >= 200 && upstreamRes.status < 300) {
      const body = await upstreamRes.text();
      try {
        observeForkRedemption(
          decodeURIComponent(forkMatch[1]!),
          JSON.parse(body) as Record<string, unknown>,
        );
      } catch (error) {
        logger.warn(
          { error: String(error) },
          "webapp proxy: fork sniff failed",
        );
      }
      res.setHeader("Content-Type", contentType);
      res.send(body);
      return;
    }
    if (contentType.includes("text/html")) {
      const html = injectInjectorScript(
        await upstreamRes.text(),
        BRIDGE_INJECT_PATH,
      );
      res.setHeader("Content-Type", contentType);
      res.send(html);
      return;
    }

    const stream = Readable.fromWeb(
      upstreamRes.body as import("stream/web").ReadableStream,
    );
    stream.on("error", (error) => {
      logger.warn({ error: String(error) }, "webapp proxy: stream failed");
      res.destroy();
    });
    stream.pipe(res);
  };
}

export function createWebappRouter(upstreamOverride?: string): Router {
  const router = Router();
  const upstream = upstreamOverride ?? getWebappConfig().upstream;
  router.use(proxyHandler(upstream));
  return router;
}
