/**
 * Schedule shapes re-exported from the vendored desktop contract
 * (packages/lumo-webview/src/types/schedules.ts) so upstream renames break
 * our build instead of drifting silently. Server-only storage additions
 * live here; the wire shapes themselves are never duplicated.
 */

export type {
  ScheduleConnection,
  ScheduleDefinition,
  ScheduleRun,
  ScheduleRunStatus,
  ScheduleTiming,
  ScheduleWorkAvailable,
} from "@lumo-webview/src/types/schedules.js";

import type {
  ScheduleDefinition,
  ScheduleRun,
} from "@lumo-webview/src/types/schedules.js";

/** Definition as stored: creation time anchors the first catch-up walk. */
export type StoredSchedule = ScheduleDefinition & { createdAt: number };

/** Run as stored: sparse extras for the history view, never on the wire. */
export type StoredRun = ScheduleRun & {
  result?: string;
  error?: string;
};
