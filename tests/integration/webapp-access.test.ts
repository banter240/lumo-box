/**
 * Webapp proxy access control: the same machine-or-unlock gate as the web
 * UI must hold for proxied Lumo app paths, or a network peer could tunnel
 * through this server's Proton connection unauthenticated.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import { request as httpRequest } from "http";
import {
  createUiLoginRouter,
  setupAuthMiddleware,
} from "../../src/api/middleware.js";
import { UI_SESSION_COOKIE, uiSessionToken } from "../../src/api/access.js";
import { listen, closeServer } from "../helpers/listen.js";

const KEY = "test-key-that-is-long-enough-123";
const WEBAPP_ON = (_path: string) => true;

/** Raw request so the Host header can be set (fetch forbids it). */
function call(
  baseUrl: string,
  path: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  location?: string;
}> {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: opts.method ?? "GET",
        headers: opts.headers,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            location: res.headers.location,
          }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe("webapp proxy access control", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(setupAuthMiddleware(KEY, WEBAPP_ON));
    app.use(createUiLoginRouter(KEY));
    // Stand-in for the catch-all: anything that passes the gate hits this.
    app.use((_req, res) => res.status(200).send("proxied"));
    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it("lets this machine browse the proxied app without a key", async () => {
    const res = await call(baseUrl, "/", {
      headers: { Host: "127.0.0.1" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe("proxied");
  });

  it("blocks other devices without a session cookie", async () => {
    const port = new URL(baseUrl).port;
    const res = await call(baseUrl, "/", {
      headers: { Host: `192.168.1.50:${port}` },
    });
    expect(res.status).toBe(401);
  });

  it("redirects other-device HTML requests to the unlock page", async () => {
    const port = new URL(baseUrl).port;
    const res = await call(baseUrl, "/", {
      headers: { Host: `192.168.1.50:${port}`, Accept: "text/html" },
    });
    expect(res.status).toBe(302);
    expect(res.location).toContain("/ui-login?next=");
  });

  it("admits other devices with the UI session cookie", async () => {
    const port = new URL(baseUrl).port;
    const res = await call(baseUrl, "/assets/x.js", {
      headers: {
        Host: `192.168.1.50:${port}`,
        Cookie: `${UI_SESSION_COOKIE}=${uiSessionToken(KEY)}`,
      },
    });
    expect(res.status).toBe(200);
  });

  it("refuses a wrong session cookie", async () => {
    const port = new URL(baseUrl).port;
    const res = await call(baseUrl, "/", {
      headers: {
        Host: `192.168.1.50:${port}`,
        Cookie: `${UI_SESSION_COOKIE}=not-the-token`,
      },
    });
    expect(res.status).toBe(401);
  });

  it("blocks cross-site writes through the proxy (CSRF)", async () => {
    const res = await call(baseUrl, "/", {
      method: "POST",
      headers: {
        Host: "127.0.0.1",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "text/plain",
      },
      body: "x",
    });
    expect(res.status).toBe(403);
  });
});
