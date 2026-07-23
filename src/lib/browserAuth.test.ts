import { beforeEach, describe, expect, it } from "vitest";
import {
  browserAuthStorageKey,
  getInitialBrowserAuthSettings,
  saveBrowserAuthSettings,
} from "./browserAuth";

describe("browser authentication preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists the browser, cookie-reading preference, and the OS-session usage flag", () => {
    saveBrowserAuthSettings({
      useBrowserCookies: false,
      useYoutubeSession: true,
      browser: "firefox",
    });

    expect(getInitialBrowserAuthSettings()).toEqual({
      useBrowserCookies: false,
      useYoutubeSession: true,
      browser: "firefox",
    });
  });

  it("does not enable a saved YouTube session alongside browser-cookie reading", () => {
    saveBrowserAuthSettings({
      useBrowserCookies: true,
      useYoutubeSession: true,
      browser: "chrome",
    });

    expect(getInitialBrowserAuthSettings()).toEqual({
      useBrowserCookies: true,
      useYoutubeSession: false,
      browser: "chrome",
    });
  });

  it("falls back safely when saved preferences are invalid", () => {
    window.localStorage.setItem(browserAuthStorageKey, "not json");

    expect(getInitialBrowserAuthSettings()).toEqual({
      useBrowserCookies: false,
      useYoutubeSession: false,
      browser: "chrome",
    });
  });
});
