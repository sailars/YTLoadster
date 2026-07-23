import type { BrowserAuthSettings } from "./types";

export const browserAuthStorageKey = "ytloadster.browserAuth";

const defaults: BrowserAuthSettings = {
  useBrowserCookies: false,
  useYoutubeSession: false,
  browser: "chrome",
};

export function getInitialBrowserAuthSettings(): BrowserAuthSettings {
  try {
    const stored = JSON.parse(window.localStorage.getItem(browserAuthStorageKey) ?? "null") as Partial<BrowserAuthSettings> | null;
    const useBrowserCookies = stored?.useBrowserCookies === true;
    return {
      useBrowserCookies,
      // This value is only an instruction to use a session held by the OS.
      // It never contains cookie data. Persisting it makes a saved YouTube
      // session available to the first URL analysis after an app restart.
      useYoutubeSession: !useBrowserCookies && stored?.useYoutubeSession === true,
      browser: typeof stored?.browser === "string" && stored.browser ? stored.browser : defaults.browser,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveBrowserAuthSettings(settings: BrowserAuthSettings) {
  try {
    window.localStorage.setItem(browserAuthStorageKey, JSON.stringify({
      useBrowserCookies: settings.useBrowserCookies,
      useYoutubeSession: !settings.useBrowserCookies && settings.useYoutubeSession,
      browser: settings.browser,
    }));
  } catch {
    // The setting remains active for the current app session.
  }
}
