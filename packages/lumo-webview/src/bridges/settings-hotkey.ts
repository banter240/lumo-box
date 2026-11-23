/**
 * Lumo desktop: in-app hotkey to open the Settings page.
 *
 * Injected into the main Lumo webview. Listens for the platform's
 * preferred settings shortcut and asks the Rust side to open settings.
 *   macOS:        Cmd + ,
 *   Windows/Linux: Ctrl + ,
 *
 * Whether the hotkey is enabled is decided in Rust (open_settings_window
 * no-ops for `source: 'hotkey'` when the user has turned the toggle off), so
 * this listener always fires and stays in sync with settings without extra
 * plumbing.
 */
import { logError } from '../shared/logger';
import { tauriInvoke } from '../shared/tauri';

(function () {
  const isMac = navigator.userAgent.toLowerCase().includes('mac');

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== ',' || e.altKey || e.shiftKey) return;
      // Require only the platform's primary modifier, nothing else.
      const primary = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!primary) return;

      e.preventDefault();
      tauriInvoke('open_settings_window', { source: 'hotkey' }).catch((err) =>
        logError('open_settings_window failed', err)
      );
    },
    true
  );
})();
