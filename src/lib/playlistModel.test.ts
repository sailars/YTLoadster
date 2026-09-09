import { describe, expect, it } from "vitest";
import type { FormatOption, MediaInfo, SubtitleOption } from "./types";
import {
  aggregatePlaylistFormats,
  chooseSubtitle,
  chooseSubtitleFormat,
  defaultPlaylistParameters,
  mediaSignatureForRequest,
  resolvePlaylistItem,
  summarizePlaylistSize,
} from "./playlistModel";

const video = (id: string, height: number, fps: number, ext: string, codec: string, size = 1000): FormatOption => ({
  formatId: id,
  qualityLabel: `${height}p ${fps}fps`,
  kind: "video",
  height,
  fps,
  ext,
  codec,
  filesize: size,
});

const audio = (id: string, codec = "mp4a", channels = 2): FormatOption => ({
  formatId: id,
  qualityLabel: "128kbps",
  kind: "audio",
  ext: codec === "opus" ? "webm" : "m4a",
  codec,
  audioChannels: channels,
  bitrateKbps: 128,
  filesize: 200,
});

function media(videoFormats: FormatOption[], audioFormats = [audio("a")], subtitles: SubtitleOption[] = []): MediaInfo {
  return { title: "Item", webpageUrl: "https://youtu.be/item", duration: 60, videoFormats, audioFormats, subtitles };
}

describe("playlist format resolution", () => {
  it("uses exact resolution, then the nearest lower resolution before a higher one", () => {
    const item = media([video("720", 720, 30, "mp4", "avc1"), video("1440", 1440, 30, "webm", "vp9")]);
    const resolved = resolvePlaylistItem(item, {
      ...defaultPlaylistParameters,
      destinationDir: "C:/Downloads",
      videoProfile: "custom",
      resolution: 1080,
      formatSelectionMode: "adaptive",
    }, "https://youtu.be/item", null);
    expect(resolved.video?.formatId).toBe("720");
    expect(resolved.warnings).toContain("resolutionReplaced");
  });

  it("rejects a custom video when strict mode has no exact parameter combination", () => {
    const item = media([
      video("240-30", 240, 30, "mp4", "H.264"),
      video("144-60", 144, 60, "webm", "VP9"),
    ]);
    const resolved = resolvePlaylistItem(item, {
      ...defaultPlaylistParameters,
      destinationDir: "C:/Downloads",
      videoProfile: "custom",
      resolution: 240,
      fps: 60,
      formatSelectionMode: "strict",
    }, "https://youtu.be/item", null);

    expect(resolved.available).toBe(false);
    expect(resolved.reason).toBe("noExactMatch");
  });

  it("accepts only the format that matches every strict custom parameter", () => {
    const item = media([
      video("wrong-fps", 240, 30, "mp4", "H.264"),
      video("exact", 240, 60, "mp4", "H.264"),
    ]);
    const resolved = resolvePlaylistItem(item, {
      ...defaultPlaylistParameters,
      destinationDir: "C:/Downloads",
      videoProfile: "custom",
      resolution: 240,
      fps: 60,
      container: "mp4",
      codec: "H.264",
      formatSelectionMode: "strict",
    }, "https://youtu.be/item", null);

    expect(resolved.available).toBe(true);
    expect(resolved.video?.formatId).toBe("exact");
    expect(resolved.warnings).toEqual([]);
  });

  it("keeps strict device profiles and rejects an incompatible item", () => {
    const item = media([video("vp9", 1080, 30, "webm", "vp09")], [audio("opus", "opus")]);
    const resolved = resolvePlaylistItem(item, {
      ...defaultPlaylistParameters,
      destinationDir: "C:/Downloads",
      videoProfile: "universal",
    }, "https://youtu.be/item", null);
    expect(resolved.available).toBe(false);
    expect(resolved.reason).toBe("noMp4");
  });

  it("uses the nearest quality for an unavailable named profile in adaptive mode", () => {
    const item = media([
      video("360", 360, 30, "mp4", "avc1"),
      video("720", 720, 30, "mp4", "avc1"),
    ]);
    const resolved = resolvePlaylistItem(item, {
      ...defaultPlaylistParameters,
      destinationDir: "C:/Downloads",
      videoProfile: "mp4-480",
      formatSelectionMode: "adaptive",
    }, "https://youtu.be/item", null);

    expect(resolved.available).toBe(true);
    expect(resolved.video?.formatId).toBe("360");
    expect(resolved.warnings).toEqual(["resolutionReplaced"]);
    expect(resolved.replacements).toEqual([
      { parameter: "resolution", requested: "480p", actual: "360p" },
    ]);
  });

  it("keeps an unavailable named quality profile unavailable in strict mode", () => {
    const resolved = resolvePlaylistItem(media([video("360", 360, 30, "mp4", "avc1")]), {
      ...defaultPlaylistParameters,
      destinationDir: "C:/Downloads",
      videoProfile: "mp4-480",
      formatSelectionMode: "strict",
    }, "https://youtu.be/item", null);

    expect(resolved.available).toBe(false);
    expect(resolved.reason).toBe("noCompatibleResolution");
  });

  it("counts union options once per analyzed item", () => {
    const options = aggregatePlaylistFormats([
      media([video("a", 1080, 60, "mp4", "avc1"), video("b", 1080, 30, "webm", "vp9")]),
      media([video("c", 720, 30, "mp4", "avc1")]),
    ]);
    expect(options.resolutions).toEqual([{ value: 1080, count: 1 }, { value: 720, count: 1 }]);
    expect(options.containers.find((item) => item.value === "mp4")?.count).toBe(2);
  });

  it("does not force stereo for a mono source", () => {
    const item = media([], [audio("mono", "mp4a", 1)]);
    const resolved = resolvePlaylistItem(item, {
      ...defaultPlaylistParameters,
      destinationDir: "C:/Downloads",
      mode: "audio",
      audioChannels: "stereo",
    }, "https://youtu.be/item", null);
    expect(resolved.request?.audioChannels).toBe("source");
    expect(resolved.warnings).toContain("monoSource");
  });

  it("keeps quality first and reports FPS, container, and codec replacements", () => {
    const item = media([video("webm", 1080, 30, "webm", "vp9")]);
    const resolved = resolvePlaylistItem(item, {
      ...defaultPlaylistParameters,
      destinationDir: "C:/Downloads",
      videoProfile: "custom",
      resolution: 1080,
      fps: 60,
      container: "mp4",
      codec: "avc1",
      formatSelectionMode: "adaptive",
    }, "https://youtu.be/item", null);

    expect(resolved.video?.formatId).toBe("webm");
    expect(resolved.warnings).toEqual(["fpsReplaced", "containerReplaced", "codecReplaced"]);
    expect(resolved.replacements).toEqual([
      { parameter: "fps", requested: "60 FPS", actual: "30 FPS" },
      { parameter: "container", requested: "MP4", actual: "WEBM" },
      { parameter: "codec", requested: "avc1", actual: "VP9" },
    ]);
    expect(resolved.request?.formatLabel).toContain("MKV 1080p 30fps VP9 + AAC");
    expect(resolved.estimatedBytes).toBe(1200);
  });

  it("estimates converted audio from the requested bitrate and duration", () => {
    const resolved = resolvePlaylistItem(media([], [audio("source")]), {
      ...defaultPlaylistParameters,
      destinationDir: "C:/Downloads",
      mode: "audio",
      audioBitrate: "320K",
    }, "https://youtu.be/item", null);

    expect(resolved.estimatedBytes).toBe(2_400_000);
  });
});

describe("playlist subtitles and size", () => {
  const tracks: SubtitleOption[] = [
    { language: "en", name: "English", automatic: true, formats: ["json3", "vtt"] },
    { language: "de", name: "Deutsch", automatic: false, formats: ["vtt"] },
  ];

  it("uses the requested automatic language before another manual language", () => {
    expect(chooseSubtitle(tracks, "en", "de", true)?.automatic).toBe(true);
    expect(chooseSubtitleFormat(["json3", "vtt"], "ass")).toBe("vtt");
  });

  it("reports known, unknown and still calculating objects separately", () => {
    expect(summarizePlaylistSize([
      { selected: true, analyzing: false, resolved: { available: true, warnings: [], estimatedBytes: 10 } },
      { selected: true, analyzing: false, resolved: { available: true, warnings: [], estimatedBytes: null } },
      { selected: true, analyzing: true },
    ])).toEqual({ bytes: 10, unknownCount: 1, calculatingCount: 1 });
  });
});

describe("playlist media signatures", () => {
  it("matches the backend signature shape and ignores cookies", () => {
    expect(mediaSignatureForRequest({
      url: "https://youtu.be/item",
      canonicalSource: "https://youtube.com/watch?v=item",
      preset: "mp4Video",
      formatId: "137",
      audioFormatId: "140",
      destinationDir: "C:/Downloads",
      cookieSource: { kind: "youtubeSession" },
      videoTechnicalDetails: { requestedContainer: "MP4" },
    })).toBe(JSON.stringify({
      Video: {
        canonical_source: "https://youtube.com/watch?v=item",
        video_format_id: "137",
        audio_format_id: "140",
        requested_container: "mp4",
      },
    }));
  });
});
