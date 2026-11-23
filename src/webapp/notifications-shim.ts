/**
 * Box-owned notifications: the desktop's native OS toasts cannot work
 * through a proxy, so this shim serves the same window.LumoNotifications
 * API on the Web Notification API instead. Injected INSTEAD of the
 * vendored bridges/notifications.js, which would otherwise overwrite it.
 */

declare global {
  interface Window {
    LumoNotifications?: {
      getPermissionState(): Promise<"not_determined" | "denied" | "granted">;
      isPermissionGranted(): Promise<boolean>;
      requestPermission(): Promise<boolean>;
      openSettings(): Promise<void>;
      show(input: { title: string; body: string }): Promise<void>;
    };
  }
}

(function () {
  "use strict";
  if (window.top !== window) return;
  if (!("Notification" in window)) return;

  function state(): "not_determined" | "denied" | "granted" {
    const p: NotificationPermission = Notification.permission;
    return p === "granted"
      ? "granted"
      : p === "denied"
        ? "denied"
        : "not_determined";
  }

  const api = {
    getPermissionState() {
      return Promise.resolve(state());
    },
    isPermissionGranted() {
      return Promise.resolve(state() === "granted");
    },
    requestPermission() {
      // Firefox resolves "denied" outright when the user ignores the prompt;
      // only "granted" counts, matching the desktop's boolean contract.
      return Notification.requestPermission().then((p) => p === "granted");
    },
    openSettings() {
      // There is no browser-equivalent of the OS notification pane; the
      // permission prompt is the closest affordance.
      if (state() === "denied") {
        window.alert(
          "Notifications are blocked for this site. Allow them in your browser settings.",
        );
      }
      return Promise.resolve();
    },
    show(input: { title: string; body: string }) {
      if (state() !== "granted") {
        return Promise.reject(new Error("notifications are not permitted"));
      }
      new Notification(input.title, { body: input.body });
      return Promise.resolve();
    },
  };
  window.LumoNotifications = api;
})();

export {};
