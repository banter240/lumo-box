/**
 * Schedule coordinator: books due occurrences, enforces missed-run policy
 * and maxConcurrency, and drives execution through the runner callback
 * (lumo_box's Lumo client). Started only when webapp.schedules.enabled is on.
 */

import { logger } from "../app/logger.js";
import { nextOccurrence } from "./occurrences.js";
import type { ScheduleStore } from "./store.js";
import type { StoredSchedule, ScheduleRun } from "./types.js";

export type ScheduleRunner = (
  schedule: StoredSchedule,
  run: ScheduleRun,
) => Promise<string>;

const TICK_MS = 30_000;
const LATE_WINDOW_MS = 60_000;
const MAX_CATCH_UP = 3;

export class ScheduleCoordinator {
  private timer?: ReturnType<typeof setInterval>;
  private active = 0;
  private stopped = false;
  /** scheduleId -> last occurrence epoch booked by this process. */
  private lastBooked = new Map<string, number>();

  constructor(
    private readonly store: ScheduleStore,
    private readonly runner: ScheduleRunner,
    private readonly maxConcurrency: number,
    private readonly notifyWork: () => void = () => {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    // Kick immediately so a freshly enabled scheduler notices due work.
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Book a run now without touching recurrence. Null when at capacity. */
  runNow(scheduleId: string): ScheduleRun | null {
    const def = this.store.get(scheduleId);
    if (!def) return null;
    if (this.active >= this.maxConcurrency) return null;
    const run = this.store.createRun({
      scheduleId: def.id,
      timingRevision: def.timingRevision,
      scheduledFor: new Date().toISOString(),
      manual: true,
    });
    this.spawn(def, run);
    this.notifyWork();
    return run;
  }

  tick(now = Date.now()): void {
    if (this.stopped) return;
    for (const def of this.store.schedules()) {
      if (!def.enabled) continue;
      if (this.active >= this.maxConcurrency) break;
      this.bookDue(def, now);
    }
  }

  /** First walk reference: the last run, else the timing's own rules (a
   *  one-shot in the past is still owed; recurrences start from now). */
  private seedFor(def: StoredSchedule, now: number): number {
    const last = this.store.runs(def.id)[0];
    if (last) {
      const at = Date.parse(last.scheduledFor);
      if (Number.isFinite(at)) return at;
    }
    return def.timing.kind === "once" ? 0 : now - LATE_WINDOW_MS;
  }

  /** Walk occurrences after the seed; on-time ones run, missed ones are
   *  folded into at most MAX_CATCH_UP late runs (run_once: only the newest). */
  private bookDue(def: StoredSchedule, now: number): void {
    let after = this.lastBooked.get(def.id) ?? this.seedFor(def, now);
    const missedRing: number[] = [];
    let booked = 0;
    while (booked < MAX_CATCH_UP) {
      const occurrence = nextOccurrence(def, after);
      if (occurrence === null || occurrence > now) break;
      after = occurrence;
      if (now - occurrence > LATE_WINDOW_MS) {
        missedRing.push(occurrence);
        if (missedRing.length > MAX_CATCH_UP) missedRing.shift();
        continue;
      }
      this.bookAndSpawn(def, occurrence, false);
      booked++;
    }
    if (
      booked === 0 &&
      missedRing.length > 0 &&
      this.active < this.maxConcurrency
    ) {
      const owed =
        def.missedRunPolicy === "run_once"
          ? [missedRing[missedRing.length - 1]!]
          : missedRing;
      for (const occurrence of owed) {
        if (this.active >= this.maxConcurrency) break;
        this.bookAndSpawn(def, occurrence, true);
      }
    }
  }

  private bookAndSpawn(
    def: StoredSchedule,
    occurrence: number,
    late: boolean,
  ): void {
    const run = this.store.createRun({
      scheduleId: def.id,
      timingRevision: def.timingRevision,
      scheduledFor: new Date(occurrence).toISOString(),
      ...(late ? { late: true } : {}),
    });
    this.lastBooked.set(def.id, occurrence);
    this.spawn(def, run);
  }

  private spawn(def: StoredSchedule, run: ScheduleRun): void {
    this.active++;
    void (async () => {
      try {
        if (!this.store.setStatus(run.runId, "accepted")) return;
        const result = await this.runner(def, run);
        this.store.setStatus(run.runId, "succeeded", { result });
      } catch (error) {
        this.store.setStatus(run.runId, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        logger.warn(
          { scheduleId: def.id, runId: run.runId, error: String(error) },
          "scheduled run failed",
        );
      } finally {
        this.active--;
        this.notifyWork();
        // Capacity freed: give runs deferred by maxConcurrency a chance
        // now instead of waiting out the full tick interval.
        this.tick();
      }
    })();
  }
}
