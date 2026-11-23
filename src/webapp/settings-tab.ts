/**
 * Tamer-owned addition to the injector: desktop opens a native settings
 * window on open_settings_window; the proxied app navigates to the served
 * settings page instead, which claims the pending tab on load via
 * take_pending_settings_tab.
 */

import {
  BRIDGE_SETTINGS_PATH,
  EVT_SHOW_SETTINGS_TAB,
} from "./bridge-constants.js";

(function () {
  "use strict";

  const tauri = (
    window as unknown as {
      __TAURI__?: {
        event: {
          listen: (
            n: string,
            h: (e: { payload?: unknown }) => void,
          ) => Promise<() => void>;
        };
      };
    }
  ).__TAURI__;
  if (!tauri) return;

  tauri.event.listen(EVT_SHOW_SETTINGS_TAB, () => {
    // Not window.open: browsers block popups from SSE-driven callbacks.
    // The tab itself travels through the bridge (take_pending_settings_tab).
    window.location.assign(BRIDGE_SETTINGS_PATH);
  });
})();
