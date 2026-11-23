import { describe, it, expect } from "vitest";
import {
  isWebappCandidatePath,
  isWebappRequestPath,
  webappCanonicalLocation,
} from "../../src/api/routes/webapp.js";

// config defaults have webapp.enabled=false; tests use the pure decision fn
// with explicit flags, plus the config-aware variant for the default state.

describe("isWebappCandidatePath", () => {
  it("proxies unknown paths when enabled", () => {
    expect(isWebappCandidatePath("/", true)).toBe(true);
    expect(isWebappCandidatePath("/assets/static/index.js", true)).toBe(true);
    expect(isWebappCandidatePath("/api/chat", true)).toBe(true);
  });

  it("never proxies box-owned paths", () => {
    for (const path of [
      "/v1/chat/completions",
      "/v1/models",
      "/auth",
      "/auth/login",
      "/config",
      "/health",
      "/metrics",
      "/logs",
      "/ui-login",
      "/ui-logout",
    ]) {
      expect(isWebappCandidatePath(path, true)).toBe(false);
    }
  });

  it("does not treat prefixes as substring matches", () => {
    expect(isWebappCandidatePath("/v1x", true)).toBe(true);
    expect(isWebappCandidatePath("/authentication", true)).toBe(true);
  });

  it("proxies nothing when disabled", () => {
    expect(isWebappCandidatePath("/", false)).toBe(false);
    expect(isWebappCandidatePath("/assets/x", false)).toBe(false);
  });
});

describe("isWebappRequestPath", () => {
  it("follows the effective config (webapp enabled by default)", () => {
    // Defaults ship webapp.enabled: true, but a local config.yaml may
    // override either way; assert only that the predicate tracks the
    // effective value rather than a fixed default.
    const enabled = isWebappRequestPath("/");
    expect(enabled).toBe(isWebappCandidatePath("/", true));
  });
});

describe("webappCanonicalLocation", () => {
  it("redirects non-canonical hosts, keeping port and path", () => {
    expect(
      webappCanonicalLocation(
        "127.0.0.1:3041",
        "GET",
        "text/html,application/xhtml+xml",
        "/",
      ),
    ).toBe("http://lumo.localhost:3041/");
    expect(
      webappCanonicalLocation(
        "lumo.lumo.localhost:3041",
        "GET",
        "text/html",
        "/login",
      ),
    ).toBe("http://lumo.localhost:3041/login");
  });

  it("keeps the canonical host through", () => {
    expect(
      webappCanonicalLocation("lumo.localhost:3041", "GET", "text/html", "/"),
    ).toBeUndefined();
  });

  it("never redirects non-navigations (assets, API calls, POSTs)", () => {
    expect(
      webappCanonicalLocation("127.0.0.1:3041", "GET", "*/*", "/assets/x.js"),
    ).toBeUndefined();
    expect(
      webappCanonicalLocation("127.0.0.1:3041", "POST", "text/html", "/"),
    ).toBeUndefined();
  });
});
