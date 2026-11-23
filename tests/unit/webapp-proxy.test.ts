import { describe, it, expect } from "vitest";
import {
  isWebappCandidatePath,
  isWebappRequestPath,
} from "../../src/api/routes/webapp.js";

// config defaults have webapp.enabled=false; tests use the pure decision fn
// with explicit flags, plus the config-aware variant for the default state.

describe("isWebappCandidatePath", () => {
  it("proxies unknown paths when enabled", () => {
    expect(isWebappCandidatePath("/", true)).toBe(true);
    expect(isWebappCandidatePath("/assets/static/index.js", true)).toBe(true);
    expect(isWebappCandidatePath("/api/chat", true)).toBe(true);
  });

  it("never proxies tamer-owned paths", () => {
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
  it("is inert in the default config (webapp disabled)", () => {
    expect(isWebappRequestPath("/")).toBe(false);
    expect(isWebappRequestPath("/anything")).toBe(false);
  });
});
