import { describe, expect, it } from "vitest";
import {
  isYouTubeAgeRestrictionError,
  isYouTubeBotConfirmationError,
  isYouTubeRateLimitError,
  sanitizeTechnicalError,
} from "./errors";

describe("technical error cleanup", () => {
  it("recognizes a YouTube 429 rate limit", () => {
    expect(isYouTubeRateLimitError("HTTP Error 429: Too Many Requests")).toBe(true);
  });

  it("recognizes a YouTube age restriction", () => {
    expect(isYouTubeAgeRestrictionError("Sign in to confirm your age")).toBe(true);
  });

  it("recognizes YouTube bot-confirmation errors", () => {
    expect(isYouTubeBotConfirmationError("Sign in to confirm you're not a bot")).toBe(true);
    expect(isYouTubeBotConfirmationError("Sign in to confirm you are not a bot")).toBe(true);
  });

  it("removes internal markdown and bare URLs", () => {
    const message = sanitizeTechnicalError(
      "WARNING: details ERROR: [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp/) failed. See https://github.com/yt-dlp/yt-dlp/wiki/EJS for details",
      "программа",
    );

    expect(message).toBe("ERROR: failed.");
    expect(message).not.toContain("github.com");
    expect(message).not.toContain("программа/программа");
  });
});
