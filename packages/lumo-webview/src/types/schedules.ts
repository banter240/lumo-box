/** Public v1 contract for clients. Native file storage is intentionally separate. */
export type ScheduleTiming =
  | { kind: 'once'; at: string }
  | { kind: 'daily'; time: string; timezone: string }
  | { kind: 'weekly'; days: number[]; time: string; timezone: string }
  | { kind: 'monthly'; days: number[]; time: string; timezone: string };

export type ScheduleDefinition = {
  id: string;
  timingRevision: number;
  enabled: boolean;
  timing: ScheduleTiming;
  missedRunPolicy: 'catch_up' | 'run_once';
};

export type ScheduleRunStatus =
  | 'pending' | 'accepted' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'skipped';

export type ScheduleRun = {
  runId: string;
  scheduleId: string;
  timingRevision: number;
  scheduledFor: string;
  /** True when the run was first queued by an explicit manual request. */
  manual: boolean;
  /** True for automatic runs queued more than 60 seconds after scheduledFor. Fixed at creation. */
  late: boolean;
  status: ScheduleRunStatus;
  updatedAt: string;
};

export type ScheduleConnection = { connectionId: string; protocolVersion: 1 };
export type ScheduleWorkAvailable = { connectionId: string };

export interface LumoSchedulesApi {
  /** Native must already know the signed-in account. Connecting replaces the previous connection. */
  connect(input: { accountId: string; protocolVersion: 1 }): Promise<ScheduleConnection>;
  /** Complete snapshot assigned to this device; never send [] to represent a failed fetch. */
  replaceSchedules(input: { connectionId: string; schedules: ScheduleDefinition[] }): Promise<void>;
  /** Queue an independent immediate run without changing the schedule cadence. */
  runNow(input: { connectionId: string; scheduleId: string }): Promise<ScheduleRun>;
  /** Reads do not acknowledge work. Receiving a run twice must not start two executions. */
  getPendingRuns(input: { connectionId: string }): Promise<ScheduleRun[]>;
  getUnsettledRuns(input: { connectionId: string }): Promise<ScheduleRun[]>;
  /** Await durable acceptance before starting execution. Terminal results may be reconciled after reload. */
  reportRunStatus(input: {
    connectionId: string; runId: string; status: Exclude<ScheduleRunStatus, 'pending'>;
  }): Promise<void>;
  /** Doorbell only. Check connectionId and fetch pending work on reconnect even if no event arrived. */
  onWorkAvailable(callback: (event: ScheduleWorkAvailable) => void): () => void;
}
