import { describe, expect, it } from "vitest";
import { classifyYoutubeSource, videoUrlFromMixedSource } from "./sourceUrl";

describe("classifyYoutubeSource", () => {
  it("distinguishes a video, a playlist and a mixed watch URL", () => {
    expect(classifyYoutubeSource("https://youtu.be/abc")).toBe("video");
    expect(classifyYoutubeSource("https://www.youtube.com/playlist?list=PL123")).toBe("playlist");
    expect(classifyYoutubeSource("https://www.youtube.com/watch?v=abc&list=PL123")).toBe("mixed");
  });

  it("rejects non-YouTube and malformed URLs", () => {
    expect(classifyYoutubeSource("https://example.com/watch?v=abc")).toBe("invalid");
    expect(classifyYoutubeSource("not a url")).toBe("invalid");
  });

  it("removes the playlist only for the single-video choice", () => {
    expect(videoUrlFromMixedSource("https://www.youtube.com/watch?v=abc&list=PL123&index=4"))
      .toBe("https://www.youtube.com/watch?v=abc");
  });
});
