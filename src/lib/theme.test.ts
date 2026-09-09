import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getInitialTheme, nextThemePreference, resolveTheme, saveTheme, themeStorageKey } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themePreference;
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers a saved theme over the system preference", () => {
    window.localStorage.setItem(themeStorageKey, "light");
    stubSystemTheme(true);

    expect(getInitialTheme()).toBe("light");
  });

  it("uses the system mode when no theme is saved", () => {
    stubSystemTheme(true);

    expect(getInitialTheme()).toBe("system");
    expect(resolveTheme(getInitialTheme())).toBe("dark");
  });

  it("applies and persists the selected theme", () => {
    applyTheme("dark");
    saveTheme("dark");

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme-preference", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");
  });

  it("applies and persists the system theme mode", () => {
    stubSystemTheme(false);

    applyTheme("system");
    saveTheme("system");

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement).toHaveAttribute("data-theme-preference", "system");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("system");
  });

  it("cycles through system, dark and light modes", () => {
    expect(nextThemePreference("system")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("light");
    expect(nextThemePreference("light")).toBe("system");
  });
});

function stubSystemTheme(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches }));
}
