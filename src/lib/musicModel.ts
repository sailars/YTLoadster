import type { DownloadPreset, DownloadRequest, FormatOption, MediaInfo, MusicDownloadContext, MusicMetadata, PlaylistInfo } from "./types";

export type MusicAudioPreset = Extract<DownloadPreset, "audioSource" | "audioMp3" | "audioM4a" | "audioOpus" | "audioFlac">;
export type MusicEdits = Partial<MusicMetadata>;

export function musicMetadata(media: MediaInfo): MusicMetadata {
  return { title: media.music?.title || media.title, artist: media.music?.artist || media.uploader || "", album: media.music?.album ?? "", albumArtist: media.music?.albumArtist ?? "", year: media.music?.year ?? "", trackNumber: media.music?.trackNumber ?? null };
}

export function musicCollectionKind(url: string, playlist?: PlaylistInfo | null): "album" | "playlist" | "liked" {
  if (playlist?.musicKind) return playlist.musicKind;
  const parsed = new URL(url);
  const list = parsed.searchParams.get("list") ?? playlist?.id ?? "";
  return list === "LM" ? "liked" : list.startsWith("OLAK5uy_") || /^\/browse\/MP/.test(parsed.pathname) ? "album" : "playlist";
}

export function musicAudioFormats(formats: FormatOption[], preset: DownloadPreset) {
  const codec = preset === "audioM4a" ? "aac" : preset === "audioOpus" ? "opus" : null;
  const compatible = codec ? formats.filter((format) => (format.codec ?? "").toLowerCase().includes(codec) || (codec === "aac" && format.ext === "m4a")) : formats;
  return [...(compatible.length ? compatible : formats)].sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0) || (b.filesize ?? 0) - (a.filesize ?? 0));
}

export function selectMusicAudio(formats: FormatOption[], preset: DownloadPreset, quality: string = "best") {
  const sorted = musicAudioFormats(formats, preset);
  if (quality === "best") return sorted[0];
  const ceiling = Number(quality);
  return sorted.find((format) => format.bitrateKbps != null && format.bitrateKbps <= ceiling) ?? sorted[sorted.length - 1];
}

export function musicConversionAvailable(preset: DownloadPreset, audio: FormatOption | undefined, encoders: string[] | null) {
  if (!audio || !encoders) return false;
  const codec = (audio.codec ?? "").toLowerCase();
  if (preset === "audioSource") return true;
  if (preset === "audioFlac") return encoders.includes("flac");
  if (preset === "audioMp3") return encoders.includes("libmp3lame");
  if (preset === "audioM4a") return codec.includes("aac") || audio.ext === "m4a" || encoders.includes("aac");
  return codec.includes("opus") || encoders.includes("libopus");
}

export function withMusicContext(request: DownloadRequest, media: MediaInfo, edits: MusicEdits = {}, collection?: { kind: "album" | "playlist" | "liked"; title: string; index: number; albumEdits?: MusicEdits; createAlbumFolder?: boolean }, sourceQuality = "best"): DownloadRequest {
  const metadata = { ...musicMetadata(media), ...edits };
  if (collection?.kind === "album") {
    const common = collection.albumEdits ?? {};
    metadata.album = common.album ?? (metadata.album || collection.title);
    metadata.albumArtist = common.albumArtist ?? (metadata.albumArtist || metadata.artist);
    metadata.year = common.year ?? metadata.year;
    metadata.trackNumber = collection.index;
  }
  const context: MusicDownloadContext = { metadata, collectionKind: collection?.kind ?? "single", collectionTitle: collection?.kind === "album" ? metadata.album : collection?.title ?? null, sourceCodec: media.audioFormats.find((format) => format.formatId === request.formatId)?.codec ?? null, sourceQuality };
  if (collection?.kind === "album") context.createAlbumFolder = collection.createAlbumFolder ?? true;
  return { ...request, title: metadata.title, music: context, includeVideoTechnicalDetailsInFilename: false };
}

export function musicAudioLabel(preset: DownloadPreset, audio?: FormatOption, bitrate?: string) {
  const output = preset === "audioSource" ? (audio?.ext === "webm" && audio.codec?.toLowerCase().includes("opus") ? "OPUS" : audio?.ext?.toUpperCase() ?? "") : preset.replace("audio", "").toUpperCase();
  return [output, preset === "audioMp3" ? bitrate?.replace("K", " kbps") : preset === "audioFlac" ? null : audio?.bitrateKbps ? `~${audio.bitrateKbps} kbps` : null].filter(Boolean).join(" ");
}

export function musicAudioBytes(audio: FormatOption | undefined, preset: DownloadPreset, bitrate: string, duration?: number | null) {
  if (preset === "audioFlac" || !audio) return null;
  if (preset === "audioMp3") return duration ? Number.parseInt(bitrate, 10) * 1000 / 8 * duration : null;
  const codec = (audio.codec ?? "").toLowerCase();
  if (preset === "audioM4a" && !codec.includes("aac") && audio.ext !== "m4a" || preset === "audioOpus" && !codec.includes("opus")) return null;
  return audio.filesize ?? (duration && audio.bitrateKbps ? audio.bitrateKbps * 1000 / 8 * duration : null);
}
