import { describe, it, expect } from "vitest";
import { parseServerUserConfig } from "../../src/app/config.js";

describe("pacing config validation (zod refinements)", () => {
  it("accepts the shipped defaults", () => {
    expect(() => parseServerUserConfig({})).not.toThrow();
  });

  it("accepts a coherent server.pacing override", () => {
    expect(() =>
      parseServerUserConfig({ server: { pacing: { minIntervalMs: 2000 } } }),
    ).not.toThrow();
  });

  it("rejects maxJitterMs below minJitterMs", () => {
    expect(() =>
      parseServerUserConfig({ server: { pacing: { minJitterMs: 5000 } } }),
    ).toThrow(/maxJitterMs/);
  });

  it("rejects longPauseMaxMs below longPauseMinMs", () => {
    expect(() =>
      parseServerUserConfig({
        server: { pacing: { longPauseMinMs: 70000 } },
      }),
    ).toThrow(/longPauseMaxMs/);
  });
});
