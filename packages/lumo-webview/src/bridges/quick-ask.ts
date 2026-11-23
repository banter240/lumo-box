/**
 * Quick-ask handoff: the web app trades the nonce from `#quickask=<nonce>` for the question typed
 * in the quick-ask window. The question itself never travels in a URL.
 */
import type { LumoQuickAskApi } from '../types/quick-ask';
import { tauriInvoke } from '../shared/tauri';

(function () {
  // Top frame only: embedded frames never get the question.
  if (window.top !== window) return;
  if (!window.__TAURI_INTERNALS__?.invoke && !window.__TAURI__?.core?.invoke) return;

  const api: LumoQuickAskApi = {
    async take(nonce) {
      return (await tauriInvoke<string | null>('take_quick_ask', { nonce })) ?? null;
    },
  };
  window.LumoQuickAsk = api;
})();
