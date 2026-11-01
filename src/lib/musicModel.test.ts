import { describe, expect, it } from "vitest";
import { musicAudioBytes, musicAudioLabel, musicCollectionKind, musicConversionAvailable, musicMetadata, selectMusicAudio, withMusicContext } from "./musicModel";
import { defaultPlaylistParameters, mediaSignatureForRequest, resolvePlaylistItem } from "./playlistModel";
import type { DownloadRequest, FormatOption, MediaInfo } from "./types";

const aac: FormatOption = { kind: "audio", formatId: "140", qualityLabel: "128 kbps", codec: "AAC", ext: "m4a", bitrateKbps: 128, filesize: 1000 };
const opus: FormatOption = { ...aac, formatId: "251", codec: "OPUS", ext: "webm", bitrateKbps: 160, filesize: 1200 };
const song: MediaInfo = { title: "Video title", uploader: "Uploader", duration: 60, videoFormats: [], audioFormats: [aac, opus], music: { title: "Song", artist: "Artist, Guest", album: "Album", albumArtist: "Artist", year: "2026", trackNumber: null } };
const request: DownloadRequest = { url: "https://music.youtube.com/watch?v=song", destinationDir: "downloads", preset: "audioSource", formatId: "251", audioChannels: "source", embedMetadata: true, embedThumbnail: true };

describe("music download model", () => {
  it("prefers a native target codec and resolves a source ceiling for each song", () => {
    expect(selectMusicAudio(song.audioFormats, "audioSource")?.formatId).toBe("251");
    expect(selectMusicAudio(song.audioFormats, "audioM4a")?.formatId).toBe("140");
    expect(selectMusicAudio(song.audioFormats, "audioSource", "128")?.formatId).toBe("140");
    expect(selectMusicAudio([aac], "audioOpus")?.formatId).toBe("140");
  });
  it("allows native Opus with old FFmpeg but requires libopus for AAC conversion", () => {
    expect(musicConversionAvailable("audioOpus", opus, ["aac"])).toBe(true);
    expect(musicConversionAvailable("audioOpus", aac, ["aac"])).toBe(false);
    expect(musicConversionAvailable("audioOpus", aac, ["libopus"])).toBe(true);
    expect(musicConversionAvailable("audioFlac", opus, ["flac"])).toBe(true);
    expect(resolvePlaylistItem({ ...song, audioFormats: [] }, { ...defaultPlaylistParameters, destinationDir: "downloads", mode: "audio", musicMode: true, audioEncoders: [] }, request.url, null).reason).toBe("noAudio");
  });
  it("uses source metadata without fabricating a release year", () => {
    expect(musicMetadata({ ...song, music: null, uploadDate: "20260101" })).toMatchObject({ title: "Video title", artist: "Uploader", year: "" });
  });
  it("keeps original album positions and guest artists when applying shared edits", () => {
    const result = withMusicContext(request, song, { title: "Edited" }, { kind: "album", title: "Collection", index: 8, albumEdits: { album: "New Album", albumArtist: "Album Artist", year: "2025" } });
    expect(result.music?.metadata).toMatchObject({ title: "Edited", artist: "Artist, Guest", album: "New Album", albumArtist: "Album Artist", year: "2025", trackNumber: 8 });
    expect(result.music?.collectionTitle).toBe("New Album");
  });
  it("keeps the album identity and tags when folder creation is disabled", () => {
    const album = { kind: "album" as const, title: "Album", index: 1 };
    const normal = withMusicContext(request, song, {}, album);
    const direct = withMusicContext(request, song, {}, { ...album, createAlbumFolder: false });
    expect(normal.music?.createAlbumFolder).toBe(true);
    expect(direct.music).toEqual({ ...normal.music, createAlbumFolder: false });
    expect(direct.destinationDir).toBe(request.destinationDir);
    expect(withMusicContext(request, song).music?.collectionKind).toBe("single");
    expect(withMusicContext(request, song).music?.createAlbumFolder).toBeUndefined();
  });
  it("does not overwrite individual albums or artists in mixed playlists", () => {
    expect(withMusicContext(request, song, { album: "" }, { kind: "playlist", title: "Road", index: 4 }).music?.metadata).toMatchObject({ artist: "Artist, Guest", album: "", trackNumber: null });
  });
  it("distinguishes output formats and tag edits while preserving untagged duplicates", () => {
    const original = withMusicContext(request, song);
    const edited = withMusicContext(request, song, { title: "Another title" });
    expect(mediaSignatureForRequest(edited)).not.toBe(mediaSignatureForRequest(original));
    expect(mediaSignatureForRequest({ ...original, preset: "audioFlac" })).not.toBe(mediaSignatureForRequest(original));
    expect(mediaSignatureForRequest({ ...edited, embedMetadata: false })).toBe(mediaSignatureForRequest({ ...original, embedMetadata: false }));
  });
  it("does not present FLAC sizes or MP3 bitrates as source quality", () => {
    expect(musicAudioBytes(opus, "audioFlac", "320K", 60)).toBeNull();
    expect(musicAudioBytes(opus, "audioMp3", "192K", 60)).toBe(1_440_000);
    expect(musicAudioLabel("audioSource", opus, "320K")).toBe("OPUS ~160 kbps");
  });
  it("builds a musical batch request with the requested source codec and no native bitrate conversion", () => {
    const result = resolvePlaylistItem(song, { ...defaultPlaylistParameters, mode: "audio", audioPreset: "audioM4a", musicMode: true, audioEncoders: ["aac"], audioChannels: "source", destinationDir: "downloads" }, request.url, null);
    expect(result.request).toMatchObject({ formatId: "140", audioBitrate: null, preset: "audioM4a", audioChannels: "source" });
    expect(musicCollectionKind("https://music.youtube.com/playlist?list=LM")).toBe("liked");
    expect(musicCollectionKind("https://music.youtube.com/browse/MPRE-album")).toBe("album");
  });
  it("queues clips only when a separate or embedded audio track is available", () => {
    const clip: MediaInfo = { ...song, audioFormats: [], videoFormats: [{ kind: "video", formatId: "18", qualityLabel: "360p MP4", height: 360, ext: "mp4" }] };
    const params = { ...defaultPlaylistParameters, musicMode: true, destinationDir: "downloads" };
    expect(resolvePlaylistItem(clip, params, request.url, null).reason).toBe("noAudio");
    expect(resolvePlaylistItem({ ...clip, videoFormats: [{ ...clip.videoFormats[0], hasAudio: true }] }, params, request.url, null).available).toBe(true);
    expect(resolvePlaylistItem({ ...clip, audioFormats: [aac] }, params, request.url, null).request?.audioFormatId).toBe("140");
  });
});
