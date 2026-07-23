import { describe, expect, it } from "vitest";
import type { FormatOption } from "../../lib/types";
import { resolveVideoProfile } from "./videoProfiles";

const video = (formatId: string, height: number, codec = "avc1", ext = "mp4"): FormatOption => ({ formatId, qualityLabel: `${height}p`, kind: "video", height, fps: 30, codec, ext, filesize: height });
const audio = (formatId: string, codec = "mp4a", ext = "m4a"): FormatOption => ({ formatId, qualityLabel: "128kbps", kind: "audio", codec, ext, filesize: 10 });

describe("resolveVideoProfile", () => {
  it("uses the exact selected H.264 and AAC streams for a device profile", () => {
    expect(resolveVideoProfile("universal", [video("137", 1080), video("399", 1080, "av01")], [audio("140"), audio("251", "opus", "webm")])).toMatchObject({ available: true, videoFormatId: "137", audioFormatId: "140" });
  });
  it("does not make an unavailable MP4 quality selectable through a lower stream", () => {
    expect(resolveVideoProfile("mp4-720", [video("137", 1080), video("136", 480)], [audio("140")])).toMatchObject({ available: false, unavailableReason: "noCompatibleResolution" });
  });
  it("does not silently make a device profile available without AAC audio", () => {
    expect(resolveVideoProfile("tablet", [video("137", 1080)], [audio("251", "opus", "webm")])).toMatchObject({ available: false, unavailableReason: "noAacAudio" });
  });
  it("prefers a compact 720p stream for phones while tablets keep 1080p", () => {
    const formats = [video("137", 1080), video("136", 720)];
    expect(resolveVideoProfile("phone", formats, [audio("140")])).toMatchObject({ available: true, videoFormatId: "136" });
    expect(resolveVideoProfile("tablet", formats, [audio("140")])).toMatchObject({ available: true, videoFormatId: "137" });
  });
});
