import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getInitialTheme, saveTheme, themeStorageKey } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
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

  it("uses the system preference when no theme is saved", () => {
    stubSystemTheme(true);

    expect(getInitialTheme()).toBe("dark");
  });

  it("applies and persists the selected theme", () => {
    applyTheme("dark");
    saveTheme("dark");

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");
  });
});

function stubSystemTheme(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches }));
}
