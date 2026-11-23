/**
 * Lumo desktop: reports which Proton account the web app is signed in as.
 *
 * Injected into the main Lumo webview. The native side namespaces connector config and secrets by
 * Proton UserID, which it never sees directly: the session lives in the web app's localStorage, so
 * it is resolved here and reported over IPC.
 *
 * Resolution mirrors how the web app identifies itself — find the active session slot (Proton's
 * "local ID"), then read that slot's stored session for its UserID. Signals are tried in order of
 * trustworthiness: the URL path only carries a slot once a session has actually been resumed;
 * `llid` is the web app's own record of the slot it last loaded, and is not cleared on sign-out.
 */
import type { AccountResolution } from '../types';
import { logError, logInfo } from '../shared/logger';
import { tauriInvoke } from '../shared/tauri';

(function () {
  'use strict';

  // A cross-origin iframe would resolve to no account and clobber a valid one.
  if (window.top !== window) return;

  const SESSION_KEY = /^ps-(\d+)$/;
  const PATH_SLOT = /^\/?u\/(\d+)(\/|$)/;

  function readItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function userIdInSlot(slot: number): string | null {
    const raw = readItem(`ps-${slot}`);
    if (!raw) return null;
    try {
      const userId = (JSON.parse(raw) as { UserID?: unknown }).UserID;
      return typeof userId === 'string' && userId ? userId : null;
    } catch (e) {
      return null;
    }
  }

  function slotFromPath(pathname: string): number | null {
    const match = PATH_SLOT.exec(pathname);
    return match ? Number(match[1]) : null;
  }

  function slotFromLastUsed(): number | null {
    const raw = readItem('llid');
    const slot = raw === null ? NaN : Number.parseInt(raw, 10);
    return Number.isInteger(slot) && slot >= 0 ? slot : null;
  }

  function onlyStoredSlot(): number | null {
    let keys: string[];
    try {
      keys = Object.keys(localStorage);
    } catch (e) {
      return null;
    }
    const slots = keys.map((key) => SESSION_KEY.exec(key)).filter(Boolean);
    return slots.length === 1 ? Number(slots[0]![1]) : null;
  }

  /**
   * A slot that names no readable session resolves to no account rather than falling through to
   * the next signal: a stale `llid` pointing at a signed-out slot must not select a different
   * account's session.
   */
  function resolve(pathname: string = window.location.pathname): AccountResolution {
    const signals: [AccountResolution['signal'], number | null][] = [
      ['path', slotFromPath(pathname)],
      ['llid', slotFromLastUsed()],
      ['single-session', onlyStoredSlot()],
    ];
    for (const [signal, slot] of signals) {
      if (slot === null) continue;
      return { userId: userIdInSlot(slot), signal, slot };
    }
    return { userId: null, signal: 'none', slot: null };
  }

  window.__lumoAccountIdentity = { resolve };

  function report(userId: string | null): Promise<void> {
    if (userId) {
      return tauriInvoke<void>('set_active_account', { userId }).catch((err) =>
        logError('[Lumo account] set_active_account failed', err)
      );
    }
    return tauriInvoke<void>('clear_active_account').catch((err) =>
      logError('[Lumo account] clear_active_account failed', err)
    );
  }

  function couldHoldSession(): boolean {
    if (!window.location.protocol.startsWith('http')) return false;
    return !['127.0.0.1', 'localhost', '[::1]', 'tauri.localhost'].includes(window.location.hostname);
  }

  const WATCH_INTERVAL_MS = 250;
  const WATCH_WINDOW_MS = 10_000;

  /**
   * Two cheap reads standing in for a full resolve, which would enumerate every localStorage key
   * on each tick. Redeeming a fork writes `llid` and moves the path onto the account's slot, so a
   * session cannot appear without one of these changing.
   */
  function sessionFingerprint(): string {
    return `${window.location.pathname}|${readItem('llid')}`;
  }

  /**
   * A switch redeems the fork while the outgoing account is still in localStorage, so a session
   * appearing is not the signal. The signal is the resolved account differing from `reported`.
   */
  function watchForAccountChange(reported: string | null): void {
    const attempts = Math.ceil(WATCH_WINDOW_MS / WATCH_INTERVAL_MS);
    let attempt = 0;
    let fingerprint = sessionFingerprint();
    const timer = setInterval(() => {
      attempt += 1;
      const current = sessionFingerprint();
      const changed = current !== fingerprint;
      fingerprint = current;
      const found: AccountResolution | { userId: null } = changed ? resolve() : { userId: null };
      if (found.userId && found.userId !== reported) {
        clearInterval(timer);
        logInfo(
          `[Lumo account] resolved ${found.userId} from ${found.signal} (slot ${found.slot}) ` +
            `${attempt * WATCH_INTERVAL_MS}ms after load`
        );
        report(found.userId);
        return;
      }
      if (attempt >= attempts) {
        clearInterval(timer);
        logInfo(`[Lumo account] account unchanged within ${WATCH_WINDOW_MS}ms, stopped watching`);
      }
    }, WATCH_INTERVAL_MS);
  }

  const { userId, signal, slot } = resolve();
  if (userId) {
    logInfo(`[Lumo account] resolved ${userId} from ${signal} (slot ${slot})`);
    report(userId);
  } else {
    logInfo(`[Lumo account] no account, from signal: ${signal}`);
    report(null);
  }
  if (couldHoldSession()) watchForAccountChange(userId);
})();
