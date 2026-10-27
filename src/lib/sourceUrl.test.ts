import { describe, expect, it } from "vitest";
import { classifyYoutubeSource, isYoutubeMusicUrl, musicSourceKind, videoUrlFromMixedSource } from "./sourceUrl";

describe("classifyYoutubeSource", () => {
  it("recognizes musical albums, liked songs and rejects radio and spoofed hosts", () => {
    expect(isYoutubeMusicUrl("https://music.youtube.com/watch?v=song")).toBe(true);
    expect(isYoutubeMusicUrl("https://music.youtube.com.example.org/watch?v=song")).toBe(false);
    expect(isYoutubeMusicUrl("ftp://music.youtube.com/watch?v=song")).toBe(false);
    expect(musicSourceKind("https://music.youtube.com/browse/MPRE-album")).toBe("playlist");
    expect(musicSourceKind("https://music.youtube.com/playlist?list=LM")).toBe("playlist");
    expect(musicSourceKind("https://music.youtube.com/playlist?list=RD123")).toBe("radio");
    expect(musicSourceKind("https://music.youtube.com/channel/artist")).toBe("channel");
  });
  it.each([
    "https://music.youtube.com/@lumimusic.official",
    "https://music.youtube.com/@lumimusic.official/videos",
    "https://music.youtube.com/browse/UC-artist",
  ])("distinguishes artist and channel pages from radio: %s", (url) => {
    expect(musicSourceKind(url)).toBe("channel");
  });
  it("keeps other unsupported music pages separate from radio", () => {
    expect(musicSourceKind("https://music.youtube.com/explore")).toBe("unsupported");
  });
  it("keeps the musical host when selecting the track from a playlist", () => {
    expect(videoUrlFromMixedSource("https://music.youtube.com/watch?v=song&list=PL123&index=2"))
      .toBe("https://music.youtube.com/watch?v=song");
  });
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
