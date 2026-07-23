import { describe, expect, it } from "vitest";
import type { FormatOption } from "../../lib/types";
import {
  bestFormatId,
  formatCodec,
  formatExt,
  formatFps,
  formatHeight,
  isQuickPresetAvailable,
  selectClosestFormat,
  selectQuickPresetFormat,
  videoFilterOptions,
} from "./videoFormats";

const detailedFormats: FormatOption[] = [
  {
    formatId: "av1-1080-60",
    qualityLabel: "1080p 60fps MP4 AV1 HDR",
    kind: "video",
    ext: "mp4",
    codec: "av01.0.08M.08",
    height: 1080,
    fps: 60,
    filesize: 160_000_000,
  },
  {
    formatId: "h264-1080-30",
    qualityLabel: "1080p 30fps MP4 H.264",
    kind: "video",
    ext: "mp4",
    codec: "avc1.640028",
    height: 1080,
    fps: 30,
    filesize: 100_000_000,
  },
  {
    formatId: "vp9-1080-30",
    qualityLabel: "1080p 30fps WebM VP9",
    kind: "video",
    ext: "webm",
    codec: "vp9",
    height: 1080,
    fps: 30,
    filesize: 90_000_000,
  },
  {
    formatId: "h264-720-30",
    qualityLabel: "720p 30fps MP4 H.264",
    kind: "video",
    ext: "mp4",
    codec: "avc1.4d401f",
    height: 720,
    fps: 30,
    filesize: 70_000_000,
  },
];

describe("videoFormats", () => {
  it("reads height fps container and codec from fields and labels", () => {
    const inferred: FormatOption = {
      formatId: "inferred",
      qualityLabel: "360p 48fps WebM VP9",
      kind: "video",
    };

    expect(formatHeight(inferred)).toBe(360);
    expect(formatFps(inferred)).toBe("48fps");
    expect(formatExt(inferred)).toBe("webm");
    expect(formatCodec(inferred)).toBe("VP9");
  });

  it("builds sorted filter options from video formats", () => {
    expect(videoFilterOptions(detailedFormats)).toEqual({
      heights: ["1080", "720"],
      fps: ["60fps", "30fps"],
      exts: ["mp4", "webm"],
      codecs: ["AV1", "H.264", "VP9"],
    });
  });

  it("selects the nearest compatible combination by relaxing untouched filters", () => {
    expect(
      selectClosestFormat(detailedFormats, "av1-1080-60", {
        ext: "webm",
      }),
    ).toBe("vp9-1080-30");
  });

  it("ranks formats by quality fps and filesize", () => {
    expect(bestFormatId(detailedFormats)).toBe("av1-1080-60");
  });

  it("selects an exact MP4 target for a quick preset", () => {
    expect(selectQuickPresetFormat(detailedFormats, "1080p")).toBe("av1-1080-60");
  });

  it("falls back to the nearest smaller MP4 when the requested preset is missing", () => {
    expect(selectQuickPresetFormat(detailedFormats, "360p")).toBe("h264-720-30");
  });

  it("selects an exact MP4 target for the 480p quick preset", () => {
    const formats = [
      ...detailedFormats,
      {
        formatId: "h264-480-30",
        qualityLabel: "480p 30fps MP4 H.264",
        kind: "video" as const,
        ext: "mp4",
        codec: "avc1.4d401e",
        height: 480,
        fps: 30,
      },
    ];

    expect(selectQuickPresetFormat(formats, "480p")).toBe("h264-480-30");
  });

  it("marks only exact MP4 quick preset resolutions as available", () => {
    expect(isQuickPresetAvailable(detailedFormats, "best")).toBe(true);
    expect(isQuickPresetAvailable(detailedFormats, "1080p")).toBe(true);
    expect(isQuickPresetAvailable(detailedFormats, "720p")).toBe(true);
    expect(isQuickPresetAvailable(detailedFormats, "480p")).toBe(false);
    expect(isQuickPresetAvailable(detailedFormats, "360p")).toBe(false);
    expect(isQuickPresetAvailable([], "1080p")).toBe(false);
  });
});
