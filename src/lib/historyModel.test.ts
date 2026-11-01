import { describe, expect, it } from "vitest";
import { historyContainsRequest, historyKeyForSource, historyKeysFromItems } from "./historyModel";
import type { DownloadRequest, HistoryItem } from "./types";

const request: DownloadRequest = { url: "https://youtu.be/Ab_c-123", destinationDir: "downloads", preset: "audioSource" };

describe("persistent history identity", () => {
  it.each([
    "https://www.youtube.com/watch?v=Ab_c-123&list=collection&t=15",
    "https://music.youtube.com/watch?v=Ab_c-123",
    "https://youtu.be/Ab_c-123?si=shared",
    "https://m.youtube.com/shorts/Ab_c-123",
    "https://www.youtube.com/embed/Ab_c-123",
    "https://youtube.com/live/Ab_c-123",
  ])("uses the same backend-compatible identity for %s", (url) => {
    expect(historyKeyForSource({ ...request, url })).toBe('["youtube:Ab_c-123","audio"]');
  });

  it("remembers the object across stream, codec, tags, folder and link changes", () => {
    const saved: HistoryItem = { id: "saved", url: request.url, preset: "audioMp3", title: "Saved track", request: { ...request, preset: "audioMp3", formatId: "old-stream" } };
    const keys = historyKeysFromItems([saved]);
    expect(historyContainsRequest(keys, { ...request, canonicalSource: "https://music.youtube.com/watch?v=Ab_c-123", preset: "audioFlac", formatId: "new-stream", destinationDir: "another-folder" })).toBe(true);
    expect(historyContainsRequest(keys, { ...request, preset: "bestVideo" })).toBe(false);
    expect(historyContainsRequest(keys, { ...request, url: "https://youtu.be/different" })).toBe(false);
    expect(historyContainsRequest(historyKeysFromItems([]), request)).toBe(false);
  });

  it("distinguishes subtitle languages and manual/automatic tracks but ignores file format", () => {
    const subtitles: DownloadRequest = { ...request, preset: "subtitles", subtitle: { language: " RU ", format: "srt", automatic: false } };
    const key = historyKeyForSource(subtitles)!;
    expect(key).toBe('["youtube:Ab_c-123","subtitles","ru","manual"]');
    const keys = new Set([key]);
    expect(historyContainsRequest(keys, { ...subtitles, subtitle: { language: "ru", format: "vtt", automatic: false } })).toBe(true);
    expect(historyContainsRequest(keys, { ...subtitles, subtitle: { language: "en", format: "srt", automatic: false } })).toBe(false);
    expect(historyContainsRequest(keys, { ...subtitles, subtitle: { language: "ru", format: "srt", automatic: true } })).toBe(false);
    const legacy = historyKeysFromItems([{ id: "old", url: request.url, preset: "subtitles", title: "Old subtitles" }]);
    expect(historyContainsRequest(legacy, subtitles)).toBe(true);
  });

  it("uses persisted keys without relying on request JSON or a session cache", () => {
    const saved: HistoryItem = { id: "old", url: request.url, title: "Old", preset: "audioSource", historyKey: '["youtube:Ab_c-123","audio"]' };
    expect(historyContainsRequest(historyKeysFromItems([saved]), request)).toBe(true);
    expect(historyContainsRequest(historyKeysFromItems([]), request)).toBe(false);
  });

  it.each(["https://youtube.com/playlist?list=album", "https://youtube.com/@artist", "https://youtube.com.evil.test/watch?v=same", "https://youtube.com/watch", "file:///watch?v=same"])("does not invent video identities for %s", (url) => {
    expect(historyKeyForSource({ ...request, url })).toBeNull();
  });
});
