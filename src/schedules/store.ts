/**
 * Schedule store: definitions + run history as one JSON file in the data
 * dir. Timing revisions bump when definitions change so in-flight runs of
 * an old revision can be told apart (protocol v1 contract).
 */

import { randomUUID } from "crypto";
import { logger } from "../app/logger.js";
import { readJsonFile, writeJsonFileAtomic } from "../app/json-file.js";
import type {
  ScheduleDefinition,
  ScheduleRun,
  ScheduleRunStatus,
  StoredSchedule,
} from "./types.js";

interface ScheduleFile {
  version: 1;
  schedules: StoredSchedule[];
  runs: ScheduleRun[];
}

const MAX_RUNS = 800;

export class ScheduleStore {
  private data: ScheduleFile = { version: 1, schedules: [], runs: [] };

  constructor(private readonly filePath: string) {
    // Missing or unreadable file = fresh store; first save recreates it.
    this.data = readJsonFile<ScheduleFile>(filePath, {
      version: 1,
      schedules: [],
      runs: [],
    });
    if (!Array.isArray(this.data.schedules)) this.data.schedules = [];
    if (!Array.isArray(this.data.runs)) this.data.runs = [];
  }

  private flush(): void {
    try {
      writeJsonFileAtomic(this.filePath, this.data);
    } catch (error) {
      logger.warn({ error: String(error) }, "schedule store: save failed");
    }
  }

  schedules(): StoredSchedule[] {
    return [...this.data.schedules];
  }

  get(scheduleId: string): StoredSchedule | undefined {
    return this.data.schedules.find((s) => s.id === scheduleId);
  }

  /** Insert or update; a timing change bumps timingRevision. */
  put(def: ScheduleDefinition): StoredSchedule {
    const existing = this.get(def.id);
    const next: StoredSchedule = existing
      ? {
          ...def,
          createdAt: existing.createdAt,
          timingRevision:
            JSON.stringify(def.timing) === JSON.stringify(existing.timing)
              ? existing.timingRevision
              : existing.timingRevision + 1,
        }
      : { ...def, createdAt: Date.now() };
    this.data.schedules = [
      ...this.data.schedules.filter((s) => s.id !== def.id),
      next,
    ];
    this.flush();
    return next;
  }

  remove(scheduleId: string): boolean {
    const before = this.data.schedules.length;
    this.data.schedules = this.data.schedules.filter(
      (s) => s.id !== scheduleId,
    );
    if (this.data.schedules.length !== before) {
      this.flush();
      return true;
    }
    return false;
  }

  runs(scheduleId?: string): ScheduleRun[] {
    const runs = scheduleId
      ? this.data.runs.filter((r) => r.scheduleId === scheduleId)
      : this.data.runs;
    return [...runs].sort((a, b) =>
      b.scheduledFor.localeCompare(a.scheduledFor),
    );
  }

  pendingRuns(): ScheduleRun[] {
    return this.data.runs.filter((r) => r.status === "pending");
  }

  unsettledRuns(): ScheduleRun[] {
    // Desktop contract (store.rs unsettled_runs): accepted/running only.
    // Pending runs are delivery work for the claim loop, not reconciliation;
    // including them makes the web client interrupt fresh runs as missing.
    return this.data.runs.filter(
      (r) => r.status === "accepted" || r.status === "running",
    );
  }

  run(runId: string): ScheduleRun | undefined {
    return this.data.runs.find((r) => r.runId === runId);
  }

  upsertRun(run: ScheduleRun): void {
    this.data.runs = [
      ...this.data.runs.filter((r) => r.runId !== run.runId),
      run,
    ].slice(-MAX_RUNS);
    this.flush();
  }

  createRun(input: {
    scheduleId: string;
    timingRevision: number;
    scheduledFor: string;
    manual?: boolean;
    late?: boolean;
  }): ScheduleRun {
    const run: ScheduleRun = {
      runId: randomUUID(),
      scheduleId: input.scheduleId,
      timingRevision: input.timingRevision,
      scheduledFor: input.scheduledFor,
      status: "pending",
      updatedAt: new Date().toISOString(),
      manual: input.manual === true,
      late: input.late === true,
    };
    this.upsertRun(run);
    return run;
  }

  /** Illegal transitions (terminal -> anything) return false. */
  setStatus(
    runId: string,
    status: Exclude<ScheduleRunStatus, "pending">,
    extras?: { result?: string; error?: string },
  ): boolean {
    const run = this.run(runId);
    if (!run) return false;
    if (
      run.status !== "pending" &&
      run.status !== "accepted" &&
      run.status !== "running"
    ) {
      return false;
    }
    this.upsertRun({
      ...run,
      status,
      updatedAt: new Date().toISOString(),
      ...extras,
    });
    return true;
  }
}
