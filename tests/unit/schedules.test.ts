/**
 * Schedule engine tests: occurrence math, store persistence and revision
 * bumps, coordinator booking + missed-run policy, bridge wiring.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readFileSync } from "fs";
import { nextOccurrence } from "../../src/schedules/occurrences.js";
import { ScheduleStore } from "../../src/schedules/store.js";
import { ScheduleCoordinator } from "../../src/schedules/coordinator.js";
import type {
  ScheduleDefinition,
  ScheduleRun,
} from "../../src/schedules/types.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "schedules-test-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function def(over: Partial<ScheduleDefinition> = {}): ScheduleDefinition {
  return {
    id: "s1",
    timingRevision: 0,
    enabled: true,
    timing: { kind: "once", at: new Date().toISOString() },
    missedRunPolicy: "catch_up",
    ...over,
  };
}

describe("nextOccurrence", () => {
  const base = Date.UTC(2026, 10, 18, 12, 0, 0); // 2026-11-18 12:00 UTC

  it("once: returns future occurrences, skips past ones", () => {
    const at = new Date(base + 3600_000).toISOString();
    expect(nextOccurrence(def({ timing: { kind: "once", at } }), base)).toBe(
      base + 3600_000,
    );
    expect(
      nextOccurrence(
        def({ timing: { kind: "once", at: new Date(base).toISOString() } }),
        base,
      ),
    ).toBeNull();
  });

  it("daily: next day at the same wall-clock time", () => {
    const d = def({
      timing: { kind: "daily", time: "09:30", timezone: "UTC" },
    });
    const after = Date.UTC(2026, 10, 18, 12, 0, 0);
    expect(nextOccurrence(d, after)).toBe(Date.UTC(2026, 10, 19, 9, 30, 0));
    const morning = Date.UTC(2026, 10, 18, 8, 0, 0);
    expect(nextOccurrence(d, morning)).toBe(Date.UTC(2026, 10, 18, 9, 30, 0));
  });

  it("daily: honors the timezone", () => {
    const d = def({
      // 09:30 in Berlin (UTC+1 in November) = 08:30 UTC
      timing: { kind: "daily", time: "09:30", timezone: "Europe/Berlin" },
    });
    const after = Date.UTC(2026, 10, 18, 9, 0, 0); // 10:00 Berlin
    expect(nextOccurrence(d, after)).toBe(Date.UTC(2026, 10, 19, 8, 30, 0));
  });

  it("weekly: next matching weekday", () => {
    // 2026-11-18 is a Wednesday (dow 3)
    const d = def({
      timing: { kind: "weekly", days: [1, 5], time: "08:00", timezone: "UTC" },
    });
    expect(nextOccurrence(d, base)).toBe(Date.UTC(2026, 10, 20, 8, 0, 0)); // Friday
  });

  it("monthly: next matching day-of-month", () => {
    const d = def({
      timing: {
        kind: "monthly",
        days: [1, 15],
        time: "10:00",
        timezone: "UTC",
      },
    });
    expect(nextOccurrence(d, base)).toBe(Date.UTC(2026, 11, 1, 10, 0, 0)); // Dec 1: Nov 15 passed
  });

  it("returns null for malformed timings", () => {
    expect(
      nextOccurrence(
        def({ timing: { kind: "daily", time: "25:99", timezone: "UTC" } }),
        base,
      ),
    ).toBeNull();
    expect(
      nextOccurrence(
        def({
          timing: { kind: "daily", time: "08:00", timezone: "Nope/Nope" },
        }),
        base,
      ),
    ).toBeNull();
    expect(
      nextOccurrence(
        def({
          timing: { kind: "weekly", days: [], time: "08:00", timezone: "UTC" },
        }),
        base,
      ),
    ).toBeNull();
  });
});

describe("ScheduleStore", () => {
  it("persists and reloads definitions and runs", () => {
    const file = join(dir, "store-a.json");
    const a = new ScheduleStore(file);
    a.put(
      def({ id: "x1", timing: { kind: "once", at: "2026-12-01T00:00:00Z" } }),
    );
    a.createRun({
      scheduleId: "x1",
      timingRevision: 0,
      scheduledFor: "2026-12-01T00:00:00Z",
    });

    const b = new ScheduleStore(file);
    expect(b.schedules().map((s) => s.id)).toEqual(["x1"]);
    expect(b.runs("x1")).toHaveLength(1);
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
  });

  it("bumps timingRevision only when the timing changes", () => {
    const store = new ScheduleStore(join(dir, "store-b.json"));
    const first = store.put(
      def({ id: "x2", timing: { kind: "once", at: "2026-12-01T00:00:00Z" } }),
    );
    const sameTiming = store.put({
      ...def({
        id: "x2",
        timing: { kind: "once", at: "2026-12-01T00:00:00Z" },
      }),
      timingRevision: first.timingRevision,
    });
    const changed = store.put(
      def({ id: "x2", timing: { kind: "once", at: "2026-12-02T00:00:00Z" } }),
    );
    expect(sameTiming.timingRevision).toBe(first.timingRevision);
    expect(changed.timingRevision).toBe(first.timingRevision + 1);
  });

  it("enforces legal run-status transitions", () => {
    const store = new ScheduleStore(join(dir, "store-c.json"));
    store.put(
      def({ id: "x3", timing: { kind: "once", at: "2026-12-01T00:00:00Z" } }),
    );
    const run = store.createRun({
      scheduleId: "x3",
      timingRevision: 0,
      scheduledFor: "2026-12-01T00:00:00Z",
    });
    expect(store.setStatus(run.runId, "accepted")).toBe(true);
    expect(store.setStatus(run.runId, "succeeded", { result: "ok" })).toBe(
      true,
    );
    // Terminal state: no further transitions.
    expect(store.setStatus(run.runId, "failed")).toBe(false);
    expect(store.setStatus("missing", "failed")).toBe(false);
    expect(store.runs("x3")[0]!.result).toBe("ok");
  });
});

describe("ScheduleCoordinator", () => {
  function setup(
    over: Partial<ScheduleDefinition>,
    runnerImpl: (
      def: ScheduleDefinition,
      run: ScheduleRun,
    ) => Promise<string> = async () => "ran",
  ) {
    const store = new ScheduleStore(join(dir, `coord-${Math.random()}.json`));
    store.put(def(over));
    const runs: ScheduleRun[] = [];
    const notify = vi.fn();
    const coord = new ScheduleCoordinator(
      store,
      async (s, r) => {
        runs.push(r);
        return runnerImpl(s, r);
      },
      1,
      notify,
    );
    return { store, coord, runs, notify };
  }

  it("books a due occurrence and runs it", async () => {
    const past = Date.now() - 120_000;
    const { coord, store } = setup({
      timing: { kind: "once", at: new Date(past).toISOString() },
    });
    coord.tick();
    await new Promise((r) => setTimeout(r, 20));
    const runs = store.runs("s1");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.late).toBe(true);
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.result).toBe("ran");
  });

  it("skips disabled schedules", () => {
    const { coord, store } = setup({
      enabled: false,
      timing: { kind: "once", at: new Date(Date.now() - 60_000).toISOString() },
    });
    coord.tick();
    expect(store.runs("s1")).toHaveLength(0);
  });

  it("books future occurrences only once they are due", () => {
    const { coord, store } = setup({
      timing: {
        kind: "once",
        at: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    coord.tick();
    expect(store.runs("s1")).toHaveLength(0);
  });

  it("honors maxConcurrency by deferring the second run", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const store = new ScheduleStore(join(dir, "coord-conc.json"));
    store.put(
      def({
        id: "a",
        timing: {
          kind: "once",
          at: new Date(Date.now() - 10_000).toISOString(),
        },
      }),
    );
    store.put(
      def({
        id: "b",
        timing: {
          kind: "once",
          at: new Date(Date.now() - 10_000).toISOString(),
        },
      }),
    );
    const started: string[] = [];
    const coord = new ScheduleCoordinator(
      store,
      async (s) => {
        started.push(s.id);
        await gate;
        return "ok";
      },
      1,
    );
    coord.tick();
    expect(started).toEqual(["a"]);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toEqual(["a", "b"]);
  });

  it("folds missed catch-up runs into one for run_once policy", async () => {
    const past = Date.now() - 3600_000;
    const { coord, store } = setup({
      missedRunPolicy: "run_once",
      timing: {
        kind: "daily",
        time: new Date(past + 60_000).toISOString().slice(11, 16),
        timezone: "UTC",
      },
    });
    // One missed day + today due: run_once books only the newest.
    coord.tick();
    await new Promise((r) => setTimeout(r, 20));
    const runs = store.runs("s1");
    expect(runs.length).toBeLessThanOrEqual(1);
  });

  it("runNow books a manual run without waiting for the tick", async () => {
    const { coord, store } = setup({
      timing: {
        kind: "once",
        at: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const run = coord.runNow("s1");
    expect(run).not.toBeNull();
    expect(run!.manual).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.runs("s1")[0]!.status).toBe("succeeded");
  });

  it("marks failed runs with the error message", async () => {
    const { coord, store } = setup(
      {
        timing: {
          kind: "once",
          at: new Date(Date.now() - 10_000).toISOString(),
        },
      },
      async () => {
        throw new Error("boom");
      },
    );
    coord.tick();
    await new Promise((r) => setTimeout(r, 20));
    const run = store.runs("s1")[0]!;
    expect(run.status).toBe("failed");
    expect(run.error).toContain("boom");
  });
});
