import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PacingConfig } from "../../src/app/config.js";
import {
  classifyTurnPacing,
  isToolResultTurn,
  type PacingPlan,
} from "../../src/lumo-client/pacer.js";
import { Role, type Turn } from "../../src/lumo-client/types.js";

const userPlan = (typingChars = 0): PacingPlan => ({
  kind: "user",
  typingChars,
});
const machinePlan = (): PacingPlan => ({ kind: "machine" });
const auxPlan = (): PacingPlan => ({ kind: "aux" });

describe("isToolResultTurn (typing-pause gate)", () => {
  it("flags proxy-fed tool-result turns", () => {
    expect(
      isToolResultTurn([
        { role: Role.User, content: "list the files" },
        {
          role: Role.User,
          content: "[Tool Result: read]\nRead directory src, entries 1-9",
        },
      ]),
    ).toBe(true);
  });

  it("passes genuine user messages", () => {
    expect(
      isToolResultTurn([{ role: Role.User, content: "refactor the pacer" }]),
    ).toBe(false);
  });

  it("ignores assistant turns and empty histories", () => {
    expect(
      isToolResultTurn([{ role: Role.Assistant, content: "[Tool Result: x]" }]),
    ).toBe(false);
    expect(isToolResultTurn([])).toBe(false);
  });
});

describe("classifyTurnPacing", () => {
  const t = (content: string): Turn[] => [
    { role: Role.User, content: "list the files" },
    { role: Role.Assistant, content: "here you go" },
    { role: Role.User, content },
  ];

  it("classifies bounces as machine regardless of content", () => {
    expect(classifyTurnPacing(t("refactor the pacer"), true)).toEqual({
      kind: "machine",
    });
  });

  it("classifies tool-result continuations as machine", () => {
    expect(
      classifyTurnPacing(t("[Tool Result: read]\nfile contents"), false),
    ).toEqual({
      kind: "machine",
    });
  });

  it("measures typing on genuine user input only", () => {
    expect(classifyTurnPacing(t("short prompt"), false)).toEqual({
      kind: "user",
      typingChars: "short prompt".length,
    });
  });

  it("tolerates empty histories", () => {
    expect(classifyTurnPacing([], false)).toEqual({
      kind: "user",
      typingChars: 0,
    });
  });
});

describe("request pacing (computePacingDelay)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function freshPacer() {
    return import("../../src/lumo-client/pacer.js");
  }

  const cfg = (over: Partial<PacingConfig> = {}): PacingConfig => ({
    enabled: true,
    minIntervalMs: 100,
    minJitterMs: 0,
    maxJitterMs: 0,
    jitterSkew: 1,
    longPauseChance: 0,
    longPauseMinMs: 0,
    longPauseMaxMs: 0,
    readingPause: { enabled: false, charsPerSec: 100, maxMs: 0 },
    circadian: { enabled: false, multiplier: 2, startHour: 23, endHour: 7 },
    typingPause: { enabled: false, charsPerSec: 200, maxMs: 0 },
    processingPause: { enabled: false, minMs: 500, maxMs: 2500 },
    burst: {
      enabled: false,
      gapMs: 180000,
      activeIntervalMs: 400,
      resumeDelayMs: 4000,
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      jitterFraction: 0,
    },
    noise: {
      speedJitterFraction: 0,
      skipReadingChance: 0,
      skipTypingChance: 0,
      sigma: 0,
      intervalJitterFraction: 0,
    },
    ...over,
  });

  it("returns 0 and reserves no slot when disabled", async () => {
    const { computePacingDelay } = await freshPacer();
    const now = 1_000_000;
    expect(computePacingDelay(cfg({ enabled: false }), userPlan(), now)).toBe(
      0,
    );
    // Disabled call must not push the slot for later enabled calls.
    expect(computePacingDelay(cfg(), userPlan(), now)).toBe(0);
  });

  it("spaces consecutive dispatches by at least minIntervalMs", async () => {
    const { computePacingDelay } = await freshPacer();
    const now = 1_000_000;
    const first = computePacingDelay(cfg(), userPlan(), now);
    expect(first).toBe(0); // idle start, zero jitter

    const second = computePacingDelay(cfg(), userPlan(), now);
    expect(second).toBeGreaterThanOrEqual(100);

    const third = computePacingDelay(cfg(), userPlan(), now + second);
    expect(third).toBeGreaterThanOrEqual(100);
  });

  it("delays the first request by random jitter within bounds", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 50; i++) {
      vi.resetModules();
      const fresh = await freshPacer();
      const delay = fresh.computePacingDelay(
        cfg({ minJitterMs: 50, maxJitterMs: 150 }),
        userPlan(),
        now,
      );
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(150);
    }
  });

  it("biases skewed jitter toward short waits", async () => {
    const now = 1_000_000;
    let short = 0;
    for (let i = 0; i < 100; i++) {
      vi.resetModules();
      const fresh = await freshPacer();
      const delay = fresh.computePacingDelay(
        cfg({ minJitterMs: 250, maxJitterMs: 2000, jitterSkew: 1.6 }),
        userPlan(),
        now,
      );
      if (delay < 700) short++;
    }
    // With skew 1.6, P(delay < 700) ≈ 0.43 — clearly above the ~0.26 a
    // uniform draw would give. Generous bound to stay flake-free.
    expect(short).toBeGreaterThan(30);
  });

  it("gives concurrent callers distinct slots", async () => {
    const { computePacingDelay } = await freshPacer();
    const now = 1_000_000;
    const a = computePacingDelay(cfg(), userPlan(), now);
    const b = computePacingDelay(cfg(), userPlan(), now);
    const c = computePacingDelay(cfg(), userPlan(), now);
    expect(a).toBe(0);
    expect(b).toBe(100);
    expect(c).toBe(200);
  });

  it("adds the full long pause when chance is 1", async () => {
    const now = 1_000_000;
    const paused = cfg({
      longPauseChance: 1,
      longPauseMinMs: 15000,
      longPauseMaxMs: 60000,
    });
    for (let i = 0; i < 10; i++) {
      vi.resetModules();
      const fresh = await freshPacer();
      const delay = fresh.computePacingDelay(paused, userPlan(), now);
      expect(delay).toBeGreaterThanOrEqual(15000);
      expect(delay).toBeLessThanOrEqual(60000);
    }
  });

  it("waits out a simulated reading pause sized by the previous reply", async () => {
    const { computePacingDelay, noteResponseVolume } = await freshPacer();
    const now = 1_000_000;
    noteResponseVolume(600); // 600 chars at 300 chars/sec = 2000ms
    const withReading = cfg({
      readingPause: { enabled: true, charsPerSec: 300, maxMs: 8000 },
    });
    expect(computePacingDelay(withReading, userPlan(), now)).toBe(2000);
    // The reply is only "read" once: no extra wait on the next request.
    expect(
      computePacingDelay(cfg(), userPlan(), now + 100),
    ).toBeGreaterThanOrEqual(100);
  });

  it("caps the reading pause at maxMs", async () => {
    const { computePacingDelay, noteResponseVolume } = await freshPacer();
    const now = 1_000_000;
    noteResponseVolume(100_000);
    const capped = cfg({
      readingPause: { enabled: true, charsPerSec: 300, maxMs: 8000 },
    });
    expect(computePacingDelay(capped, userPlan(), now)).toBe(8000);
  });

  it("never produces the same delay for identical inputs (noise layer)", async () => {
    const now = 1_000_000;
    const loud = cfg({
      minJitterMs: 250,
      maxJitterMs: 2000,
      noise: {
        speedJitterFraction: 0,
        skipReadingChance: 0,
        skipTypingChance: 0,
        sigma: 0.12,
        intervalJitterFraction: 0,
      },
    });
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      vi.resetModules();
      const fresh = await freshPacer();
      seen.add(fresh.computePacingDelay(loud, userPlan(), now));
    }
    // With sigma wobble, identical situations must not repeat bit-for-bit.
    expect(seen.size).toBeGreaterThan(10);
  });

  it("varies reading speed so delay does not correlate perfectly with reply size", async () => {
    const now = 1_000_000;
    const withSpeedNoise = cfg({
      readingPause: { enabled: true, charsPerSec: 300, maxMs: 8000 },
      noise: {
        speedJitterFraction: 0.4,
        skipReadingChance: 0,
        skipTypingChance: 0,
        sigma: 0,
        intervalJitterFraction: 0,
      },
    });
    const delays = new Set<number>();
    for (let i = 0; i < 20; i++) {
      vi.resetModules();
      const fresh = await freshPacer();
      fresh.noteResponseVolume(600); // same reply size every time
      delays.add(fresh.computePacingDelay(withSpeedNoise, userPlan(), now));
    }
    // Same input, yet the reading contribution varies.
    expect(delays.size).toBeGreaterThan(5);
  });

  it("applies a bounded processing pause to machine-fed continuations", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) {
      vi.resetModules();
      const fresh = await freshPacer();
      const delay = fresh.computePacingDelay(
        cfg({ processingPause: { enabled: true, minMs: 500, maxMs: 2500 } }),
        machinePlan(),
        now,
      );
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(2500);
    }
  });

  it("charges no processing pause to machine turns when disabled", async () => {
    const { computePacingDelay } = await freshPacer();
    const now = 1_000_000;
    expect(computePacingDelay(cfg(), machinePlan(), now)).toBe(0);
  });

  it("skips reading and typing simulation for aux requests", async () => {
    const { computePacingDelay, noteResponseVolume } = await freshPacer();
    const now = 1_000_000;
    noteResponseVolume(100_000);
    const heavy = cfg({
      readingPause: { enabled: true, charsPerSec: 300, maxMs: 8000 },
      typingPause: { enabled: true, charsPerSec: 200, maxMs: 10000 },
      longPauseChance: 1,
      longPauseMinMs: 15000,
      longPauseMaxMs: 60000,
    });
    expect(computePacingDelay(heavy, auxPlan(), now)).toBe(0);
  });

  it("waits out a simulated typing pause sized by the outgoing message", async () => {
    const { computePacingDelay } = await freshPacer();
    const now = 1_000_000;
    const withTyping = cfg({
      typingPause: { enabled: true, charsPerSec: 200, maxMs: 10000 },
    });
    // 400 chars at 200 chars/sec = 2000ms
    expect(computePacingDelay(withTyping, userPlan(400), now)).toBe(2000);
  });

  it("multiplies the wait during quiet hours", async () => {
    const { computePacingDelay } = await freshPacer();
    const now = 1_000_000;
    const night = cfg({
      minJitterMs: 100,
      maxJitterMs: 100,
      circadian: { enabled: true, multiplier: 3, startHour: 0, endHour: 23 },
    });
    expect(computePacingDelay(night, userPlan(), now)).toBe(300);
  });
});

describe("burst-aware spacing", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const base: PacingConfig = {
    enabled: true,
    minIntervalMs: 1000,
    minJitterMs: 0,
    maxJitterMs: 0,
    jitterSkew: 1,
    longPauseChance: 0,
    longPauseMinMs: 0,
    longPauseMaxMs: 0,
    readingPause: { enabled: false, charsPerSec: 100, maxMs: 0 },
    circadian: { enabled: false, multiplier: 2, startHour: 23, endHour: 7 },
    typingPause: { enabled: false, charsPerSec: 200, maxMs: 0 },
    processingPause: { enabled: false, minMs: 500, maxMs: 2500 },
    burst: {
      enabled: true,
      gapMs: 180000,
      activeIntervalMs: 400,
      resumeDelayMs: 4000,
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      jitterFraction: 0,
    },
    noise: {
      speedJitterFraction: 0,
      skipReadingChance: 0,
      skipTypingChance: 0,
      sigma: 0,
      intervalJitterFraction: 0,
    },
  };

  it("relaxes the interval inside an active burst", async () => {
    const { computePacingDelay } =
      await import("../../src/lumo-client/pacer.js");
    const now = 1_000_000;
    expect(computePacingDelay(base, userPlan(), now)).toBe(0);
    // Arrived 100ms after the first dispatch: held to the active interval
    // (400ms after that dispatch), not the full minIntervalMs.
    const second = computePacingDelay(base, userPlan(), now + 100);
    expect(second).toBe(300);
  });

  it("pays a resume delay after the burst gap elapsed", async () => {
    const { computePacingDelay } =
      await import("../../src/lumo-client/pacer.js");
    const now = 1_000_000;
    computePacingDelay(base, userPlan(), now);
    // Far past the gap: fresh session, resumeDelay applies.
    const delay = computePacingDelay(
      base,
      userPlan(),
      now + base.burst.gapMs + 10_000,
    );
    expect(delay).toBe(base.burst.resumeDelayMs);
  });

  it("restores full spacing after a burst ended", async () => {
    const { computePacingDelay } =
      await import("../../src/lumo-client/pacer.js");
    const now = 1_000_000;
    computePacingDelay(base, userPlan(), now);
    // After the gap the old slot must not leak into the new session.
    const first = computePacingDelay(
      base,
      userPlan(),
      now + base.burst.gapMs + 10_000,
    );
    expect(first).toBe(base.burst.resumeDelayMs);
    const second = computePacingDelay(
      base,
      userPlan(),
      now + base.burst.gapMs + 10_000 + first,
    );
    // We are in a new burst (resume delay < gap): second request inside it.
    // But full minInterval? No — new burst is active, so 400 applies.
    expect(second).toBe(400);
  });
});

describe("isQuietHour (wraparound)", () => {
  it("handles ranges that wrap midnight", async () => {
    const { isQuietHour } = await import("../../src/lumo-client/pacer.js");
    const c = {
      enabled: true,
      multiplier: 2,
      startHour: 23,
      endHour: 7,
    } as PacingConfig["circadian"];
    expect(isQuietHour(23, c)).toBe(true);
    expect(isQuietHour(3, c)).toBe(true);
    expect(isQuietHour(6, c)).toBe(true);
    expect(isQuietHour(7, c)).toBe(false);
    expect(isQuietHour(12, c)).toBe(false);
    expect(isQuietHour(22, c)).toBe(false);
  });

  it("handles same-day ranges", async () => {
    const { isQuietHour } = await import("../../src/lumo-client/pacer.js");
    const c = {
      enabled: true,
      multiplier: 2,
      startHour: 9,
      endHour: 17,
    } as PacingConfig["circadian"];
    expect(isQuietHour(9, c)).toBe(true);
    expect(isQuietHour(16, c)).toBe(true);
    expect(isQuietHour(17, c)).toBe(false);
    expect(isQuietHour(8, c)).toBe(false);
  });
});

describe("retry backoff (computeRetryDelay)", () => {
  const retryCfg = (over: Partial<PacingConfig["retry"]> = {}) => ({
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    jitterFraction: 0,
    ...over,
  });

  it("doubles the base delay per attempt", async () => {
    const { computeRetryDelay } = await import("../../src/lumo-client/pacer.js");
    expect(computeRetryDelay(retryCfg(), 1)).toBe(1000);
    expect(computeRetryDelay(retryCfg(), 2)).toBe(2000);
    expect(computeRetryDelay(retryCfg(), 3)).toBe(4000);
  });

  it("caps the delay at maxDelayMs", async () => {
    const { computeRetryDelay } = await import("../../src/lumo-client/pacer.js");
    expect(computeRetryDelay(retryCfg(), 10)).toBe(30000);
  });

  it("applies symmetric jitter within the fraction", async () => {
    const { computeRetryDelay } = await import("../../src/lumo-client/pacer.js");
    const cfg = retryCfg({ jitterFraction: 0.5 });
    const draws = new Set<number>();
    for (let i = 0; i < 40; i++) draws.add(computeRetryDelay(cfg, 1));
    const min = Math.min(...draws);
    const max = Math.max(...draws);
    expect(min).toBeGreaterThanOrEqual(500);
    expect(max).toBeLessThanOrEqual(1500);
    expect(draws.size).toBeGreaterThan(1);
  });

  it("stays within bounds even at attempt 0 overflow", async () => {
    const { computeRetryDelay } = await import("../../src/lumo-client/pacer.js");
    const delay = computeRetryDelay(retryCfg({ maxDelayMs: 2000, jitterFraction: 0.1 }), 30);
    expect(delay).toBeGreaterThanOrEqual(1800);
    expect(delay).toBeLessThanOrEqual(2200);
  });
});
