import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInitialLocale, localeStorageKey } from "./i18n";

describe("locale initialization", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers a saved locale over the system language", () => {
    window.localStorage.setItem(localeStorageKey, "en");
    stubSystemLanguages(["ru-RU"]);

    expect(getInitialLocale()).toBe("en");
  });

  it("uses Russian for a Russian system language", () => {
    stubSystemLanguages(["ru-RU"]);

    expect(getInitialLocale()).toBe("ru");
  });

  it("uses English for Bulgarian and other unsupported system languages", () => {
    stubSystemLanguages(["bg-BG"]);

    expect(getInitialLocale()).toBe("en");
  });

  it("uses the primary system language when several preferences are available", () => {
    stubSystemLanguages(["bg-BG", "ru-RU"]);

    expect(getInitialLocale()).toBe("en");
  });
});

function stubSystemLanguages(languages: string[]) {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(window.navigator, "language", "get").mockReturnValue(languages[0] ?? "");
}
