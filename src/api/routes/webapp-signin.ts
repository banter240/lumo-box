/**
 * Proton fork sign-in for the proxied web app (webapp.enabled).
 *
 * Same login path as tamer's /auth (desktop fork login), with one
 * deviation: account only whitelists redirectUrls registered for the app
 * (desktop uses the proton-lumo:// scheme), so no redirectUrl is sent.
 * /start shows a holding page: sign in at account (new tab), then the
 * Continue button hands off to /login#selector=&sk= where the web app
 * redeems the fork client-side. The fork GET is CONSUMING, so tamer
 * never fetches it: the proxy sniffs the app's own redemption response
 * (observeForkRedemption) and fills the tamer vault alongside.
 */

import { Router } from "express";
import { randomBytes } from "crypto";
import { getWebappConfig } from "../../app/config.js";
import { logger } from "../../app/logger.js";
import { reserveFork, forkTokens } from "../../auth/desktop-login.js";
import {
  produceWebappFork,
  FORK_CHILD_CLIENT_ID,
} from "../../auth/webapp-fork.js";
import { hasProtonSyncKeys } from "../../auth/sync-capability.js";
import type { AuthManager } from "../../auth/manager.js";
import type { ProtonApi } from "../../lumo-client/types.js";

/** Server session pieces /auto needs; undefined when not signed in. */
export type WebappAutoSession = { api: ProtonApi; keyPassword: string };

const TTL_MS = 10 * 60 * 1000;

/** The web app stores the fork under its own client ID; a mismatch
 * surfaces as "Invalid selector", so this must stay web-lumo. */
/** /login#selector=…&sk=… handoff the web app redeems the fork with. */

interface Pending {
  selector: string;
  key: Buffer;
  state: string;
  startedAt: number;
}

const pending = new Map<string, Pending>();

function dropExpired(): void {
  const now = Date.now();
  for (const [id, item] of pending) {
    if (now - item.startedAt > TTL_MS) pending.delete(id);
  }
}

function upstreamApiBase(): string {
  return new URL(getWebappConfig().upstream).origin + "/api";
}

/** account.proton.me style host derived from the lumo upstream host. */
export function accountUrlForUpstream(upstream: string): string {
  const host = new URL(upstream).host;
  if (!/^lumo\./.test(host)) {
    throw new Error(`Expected a lumo.* upstream host, got '${host}'`);
  }
  return `https://account.${host.slice("lumo.".length)}`;
}

/** No redirectUrl: account rejects unregistered callbacks. */
export function buildAccountLoginUrl(
  accountUrl: string,
  userCode: string,
  key: Buffer,
  childClientId: string,
): string {
  const app = childClientId.split("-")[1] ?? "";
  if (!app) {
    throw new Error(`client ID '${childClientId}' is not <platform>-<product>`);
  }
  const payload = `0:${userCode}:${key.toString("base64")}:${childClientId}`;
  const u = new URL(`${accountUrl.replace(/\/$/, "")}/desktop/login`);
  u.searchParams.set("app", app);
  u.searchParams.set("pv", "3");
  u.hash = `payload=${encodeURIComponent(payload)}`;
  return u.toString();
}

/** /login#selector=…&sk=… handoff the web app redeems the fork with. */
export function handoffPath(selector: string, key: Buffer): string {
  const sk = key.toString("base64url").replace(/=$/, "");
  const params = `selector=${encodeURIComponent(selector)}&sk=${encodeURIComponent(sk)}&pv=3&p=1&returnUrl=${encodeURIComponent("/")}`;
  return `/login#${params}`;
}

/** Holding page: sign in at account, then Continue hands off to the app. */
function holdingPage(loginUrl: string, state: string): string {
  const esc = (s: string) =>
    s.replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
    );
  const account = esc(loginUrl);
  const handoff = esc(
    `/webapp-signin/handoff?state=${encodeURIComponent(state)}`,
  );
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · lumo-tamer</title><style>
body{font:16px/1.5 system-ui,sans-serif;background:#1b1340;color:#eee;
  display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:#241a52;padding:2rem 2.5rem;border-radius:12px;max-width:26rem}
h1{font-size:1.1rem;margin:0 0 1rem}
a.btn,button{display:inline-block;background:#6d4aff;color:#fff;border:0;
  border-radius:8px;padding:.6rem 1.2rem;font:inherit;cursor:pointer;
  text-decoration:none;margin-top:1rem}
#status{color:#9f97c9;margin-top:1rem;min-height:1.2em}
</style></head><body><div class="card">
<h1>Sign in with Proton</h1>
<ol>
<li>Open the Proton sign-in and log in.</li>
<li>Return here; the handoff continues automatically.</li>
</ol>
<a class="btn" href="${account}" target="_blank" rel="opener">Open Proton sign-in</a><br>
<a class="btn" id="go" href="${handoff}">Continue to Lumo</a>
<div id="status"></div>
<script>
// Desktop equivalent of the proton-lumo:// callback: refocusing this tab
// means account sign-in finished. Only the APP redeems the (consuming)
// fork via its own GET; the handoff merely navigates there.
let fired = false;
function go() {
  if (fired) return;
  fired = true;
  document.getElementById("status").textContent = "Signing you in\u2026";
  location.href = ${JSON.stringify(`/webapp-signin/handoff?state=${encodeURIComponent(state)}`)};
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") go();
});
window.addEventListener("focus", go);
if (document.visibilityState === "visible") {
  document.getElementById("status").textContent =
    "Waiting for Proton sign-in\u2026";
}
</script></div></body></html>`;
}

/**
 * Proxy hook: the app's fork redemption ran through us. Fill the tamer
 * vault from the same response the app consumes — the fork GET is
 * consuming, so sniffing is the only chance to see the payload.
 */
export function observeForkRedemption(
  selector: string,
  json: Record<string, unknown>,
): void {
  dropExpired();
  const entry = pending.get(selector);
  if (!entry) return;
  pending.delete(selector);
  void forkTokens(json, entry.key)
    .then((tokens) =>
      logger.info(
        { sync: hasProtonSyncKeys(tokens) },
        "webapp signin: fork harvested to vault",
      ),
    )
    .catch((error) =>
      logger.warn(
        { error: String(error) },
        "webapp signin: vault harvest failed",
      ),
    );
}

/**
 * Single sign-in: mint the webapp fork from the RUNNING tamer session
 * (pushForkSession, Independent:1 — separate app tokens, no refresh race)
 * and hand the browser straight to the app's /login#selector&sk redemption.
 * Falls back to /start (account.proton.me round trip) when the server has
 * no valid session.
 */
export function createWebappSigninRouter(
  auth?: () => WebappAutoSession | undefined,
): Router {
  const router = Router();

  router.get("/auto", async (_req, res) => {
    const session = auth?.();
    if (!session) {
      res.redirect(302, "/webapp-signin/start");
      return;
    }
    try {
      const { selector, keyB64u } = await produceWebappFork(
        session.api,
        session.keyPassword,
      );
      res.redirect(
        302,
        handoffPath(selector, Buffer.from(keyB64u, "base64url")),
      );
    } catch (error) {
      logger.warn(
        { error: String(error) },
        "webapp signin: server fork push failed; falling back to account flow",
      );
      res.redirect(302, "/webapp-signin/start");
    }
  });

  router.get("/start", async (_req, res) => {
    dropExpired();
    try {
      const { selector, userCode } = await reserveFork(upstreamApiBase());
      const key = randomBytes(32);
      const state = randomBytes(16).toString("base64url");
      pending.set(selector, {
        selector,
        key,
        state,
        startedAt: Date.now(),
      });
      const url = buildAccountLoginUrl(
        accountUrlForUpstream(getWebappConfig().upstream),
        userCode,
        key,
        FORK_CHILD_CLIENT_ID,
      );
      logger.info("webapp signin: fork reserved, holding page served");
      res.type("html").send(holdingPage(url, state));
    } catch (error) {
      logger.warn(
        { error: String(error) },
        "webapp signin: fork reserve failed",
      );
      res.status(502).type("text/plain").send("Could not start Proton sign-in");
    }
  });

  // User signed in at account and came back: trampoline onto the app's
  // fork redemption route. The pending entry STAYS until the proxy
  // observes the app's redemption (or TTL) — the GET that consumes the
  // fork belongs to the app, not to us.
  router.get("/handoff", (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const entry = [...pending.values()].find((p) => p.state === state);
    if (!entry) {
      res
        .status(400)
        .type("text/plain")
        .send("Unknown or expired sign-in. Start again from the app.");
      return;
    }
    res.redirect(302, handoffPath(entry.selector, entry.key));
  });

  return router;
}
