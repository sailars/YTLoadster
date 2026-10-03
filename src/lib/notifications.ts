import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { api } from "./api";
import { translate, type AppLocale } from "./i18n";

export const notificationsStorageKey = "ytloadster.notifications";

export function getInitialNotificationsEnabled() {
  try {
    return window.localStorage.getItem(notificationsStorageKey) === "true";
  } catch {
    return false;
  }
}

export function saveNotificationsEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(notificationsStorageKey, String(enabled));
  } catch {
    // Notification state remains available for the current session.
  }
}

export async function requestNotificationAccess() {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

async function showSystemNotification(title: string, body: string, sound: boolean) {
  try {
    await api.showSystemNotification(title, body, sound);
    return true;
  } catch {
    return false;
  }
}

export function showNotificationsEnabledNotification(locale: AppLocale) {
  return showSystemNotification(
    translate(locale, "notifications.enabledTitle"),
    translate(locale, "notifications.enabledBody"),
    false,
  );
}

export async function showDownloadCompletedNotification(title: string | null | undefined, locale: AppLocale) {
  try {
    if (!(await isPermissionGranted())) return false;
    const displayTitle = title?.trim() || translate(locale, "notifications.untitled");
    return await showSystemNotification(
      translate(locale, "notifications.completedTitle"),
      translate(locale, "notifications.completedBody", { title: displayTitle }),
      true,
    );
  } catch {
    return false;
  }
}
