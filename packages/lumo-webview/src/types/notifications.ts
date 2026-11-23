export type NotificationPermission = 'not_determined' | 'denied' | 'granted';

export interface LumoNotificationsApi {
  getPermissionState(): Promise<NotificationPermission>;
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  openSettings(): Promise<void>;
  show(input: { title: string; body: string }): Promise<void>;
}
