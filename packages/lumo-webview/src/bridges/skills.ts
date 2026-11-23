import type { SkillRuntime } from '../types/skills';
import { tauriInvoke } from '../shared/tauri';

(function () {
  if (window.top !== window) return;
  if (!window.__TAURI_INTERNALS__?.invoke && !window.__TAURI__?.core?.invoke) return;
  async function invoke<T>(command: string, input: Record<string, unknown>): Promise<T> {
    const userId = window.__lumoAccountIdentity?.resolve?.().userId;
    if (!userId) throw new Error('Skill execution requires a signed-in account');
    const result = await tauriInvoke<T>(command, { ...input, userId });
    if (window.__lumoAccountIdentity?.resolve?.().userId !== userId) throw new Error('Account changed');
    return result;
  }
  function encode(bytes: Uint8Array): string {
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    }
    return btoa(chunks.join(''));
  }
  const api: SkillRuntime = {
    protocolVersion: 1,
    syncBundle(bundle) {
      return invoke('skill_sync_bundle', { ...bundle, files: bundle.files.map(({ path, data }) => ({ path, data: encode(data) })) });
    },
    executeScript(request) { return invoke('skill_execute_script', { request }); },
    retain(input) { return invoke('skill_cache_retain', input); },
  };
  window.LumoSkillRuntime = api;
})();
