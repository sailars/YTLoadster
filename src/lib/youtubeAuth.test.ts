import { describe, expect, it } from "vitest";
import { hasAuthenticatedYoutubeCookies } from "./youtubeAuth";
import type { BrowserCookie } from "./types";

function cookie(name: string, domain = ".youtube.com"): BrowserCookie {
  return {
    name,
    value: "value",
    domain,
    path: "/",
    expires: 1_900_000_000,
    secure: true,
  };
}

describe("YouTube authentication cookies", () => {
  it("recognizes an authenticated YouTube session", () => {
    expect(hasAuthenticatedYoutubeCookies([cookie("SAPISID")])).toBe(true);
  });

  it("ignores Google cookies and non-authentication YouTube cookies", () => {
    expect(
      hasAuthenticatedYoutubeCookies([
        cookie("SID", ".google.com"),
        cookie("PREF"),
      ]),
    ).toBe(false);
  });
});
