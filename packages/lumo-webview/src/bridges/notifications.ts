/** Native notifications only; completion opt-in and localized text belong to clients. */
import type { LumoNotificationsApi, NotificationPermission } from '../types/notifications';
import { tauriInvoke } from '../shared/tauri';

(function () {
  if (window.top !== window) return;
  if (!window.__TAURI_INTERNALS__?.invoke && !window.__TAURI__?.core?.invoke) return;

  const api: LumoNotificationsApi = {
    getPermissionState() {
      return tauriInvoke<NotificationPermission>('desktop_notification_permission_state');
    },
    isPermissionGranted() {
      return tauriInvoke<boolean>('desktop_notification_permission', { request: false });
    },
    requestPermission() {
      return tauriInvoke<boolean>('desktop_notification_permission', { request: true });
    },
    openSettings() {
      return tauriInvoke<void>('desktop_notification_open_settings');
    },
    show(input) {
      const userId = window.__lumoAccountIdentity?.resolve?.().userId;
      if (!userId) return Promise.reject(new Error('No account is signed in'));
      return tauriInvoke<void>('desktop_notification_show', { ...input, userId });
    },
  };
  window.LumoNotifications = api;
})();
