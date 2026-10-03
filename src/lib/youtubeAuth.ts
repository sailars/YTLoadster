import type { Translate } from "./i18n";

export function localizedYoutubeAuthError(message: string, t: Translate): string | null {
  if (message.includes("youtube-auth-cancelled")) return t("settings.youtubeAuthCancelled");
  if (message.includes("youtube-auth-session-unavailable")) return t("settings.youtubeAuthSessionUnavailable");
  if (message.includes("youtube-auth-refresh-failed")) return t("settings.youtubeAuthRefreshFailed");
  if (message.includes("youtube-auth-connection-failed")) return t("settings.youtubeAuthFailed");
  return null;
}
