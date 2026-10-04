import { describe, expect, it } from "vitest";
import { translate, type AppLocale, type Translate } from "./i18n";
import { localizedYoutubeAuthError } from "./youtubeAuth";

describe("YouTube authentication errors", () => {
  it.each(["ru", "en"] as AppLocale[])("explains live-session errors in %s", (locale) => {
    const t: Translate = (key, values) => translate(locale, key, values);
    expect(localizedYoutubeAuthError("youtube-auth-session-unavailable", t))
      .toBe(locale === "ru"
        ? "Сессия YouTube не активна. Завершите вход в отдельном окне или откройте Настройки → Авторизация → Войти в YouTube и войдите повторно."
        : "The YouTube session is not active. Complete sign-in in the separate window or open Settings → Authorization → Sign in to YouTube and sign in again.");
    expect(localizedYoutubeAuthError("Error: youtube-auth-refresh-failed", t))
      .toBe(locale === "ru"
        ? "Не удалось обновить сессию YouTube. Проверьте отдельное окно входа и повторите попытку."
        : "Could not refresh the YouTube session. Check the separate sign-in window and try again.");
    expect(localizedYoutubeAuthError("youtube-auth-connection-failed", t))
      .toBe(locale === "ru" ? "Не удалось завершить вход в YouTube." : "Could not complete YouTube sign-in.");
  });

  it("leaves unrelated errors to the existing error formatter", () => {
    expect(localizedYoutubeAuthError("HTTP error 403", (key) => key)).toBeNull();
  });
});
