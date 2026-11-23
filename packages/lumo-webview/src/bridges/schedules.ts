/** Injected transport only: authentication, API synchronization and execution live in clients. */
import type { LumoSchedulesApi, ScheduleConnection, ScheduleRun, ScheduleWorkAvailable } from '../types/schedules';
import { tauriInvoke } from '../shared/tauri';
import { logWarn } from '../shared/logger';

(function () {
  if (window.top !== window) return;
  if (!window.__TAURI_INTERNALS__?.invoke && !window.__TAURI__?.core?.invoke) return;

  const callbacks = new Set<(event: ScheduleWorkAvailable) => void>();
  let listening: Promise<void> | undefined;

  function ensureListening(): Promise<void> {
    if (!listening) {
      const listen = window.__TAURI__?.event?.listen || window.__TAURI_INTERNALS__?.event?.listen;
      if (!listen) return Promise.reject(new Error('Tauri event API not available'));
      listening = listen('schedules:work_available', ({ payload }) => {
        if (!payload || typeof payload !== 'object' || !('connectionId' in payload) || typeof payload.connectionId !== 'string') return;
        const notice = { connectionId: payload.connectionId };
        for (const callback of callbacks) {
          try { callback(notice); }
          catch (error) { logWarn('[LumoSchedules] work listener failed', error); }
        }
      }).then(() => {}, (error: unknown) => {
        listening = undefined;
        throw error;
      });
    }
    return listening;
  }

  const api: LumoSchedulesApi = {
    async connect(input) {
      // Subscribe before native can emit a notice during connect. Failed setup can be retried.
      await ensureListening();
      return tauriInvoke<ScheduleConnection>('schedule_connect', input);
    },
    replaceSchedules({ connectionId, schedules }) {
      return tauriInvoke<void>('schedule_replace', {
        connectionId,
        schedules: schedules.map((schedule) => ({
          id: schedule.id, timing_revision: schedule.timingRevision, enabled: schedule.enabled,
          timing: schedule.timing, missed_run_policy: schedule.missedRunPolicy,
        })),
      });
    },
    runNow(input) { return tauriInvoke<ScheduleRun>('schedule_run_now', input); },
    getPendingRuns(input) { return tauriInvoke<ScheduleRun[]>('schedule_pending', input); },
    getUnsettledRuns(input) { return tauriInvoke<ScheduleRun[]>('schedule_unsettled', input); },
    reportRunStatus(input) { return tauriInvoke<void>('schedule_report_status', input); },
    onWorkAvailable(callback) {
      callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    },
  };
  window.LumoSchedules = api;
})();
