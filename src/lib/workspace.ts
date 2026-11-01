import type { DownloadPreset, MediaInfo, PlaylistEntry, PlaylistInfo, VideoDownloadProfile } from "./types";
import type { MusicEdits, withMusicContext } from "./musicModel";
import { defaultPlaylistParameters, type PlaylistParameters } from "./playlistModel";

export const workspaceStorageKey = "ytloadster.workspace";
export type WorkspaceKey = "new" | "playlist" | "musicSingle" | "musicCollection";
export type DownloadSection = "new" | "playlist" | "music";

export type SingleWorkspace = {
  kind: "single";
  url: string;
  media: MediaInfo | null;
  mode: "video" | "audio" | "subtitles";
  preset: DownloadPreset;
  destinationDir: string;
  videoProfile: VideoDownloadProfile;
  selectedVideoFormatId: string | null;
  selectedAudioFormatId: string | null;
  selectedSubtitleKey: string | null;
  selectedSubtitleFormat: string | null;
  audioBitrate: string;
  audioChannels: string;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  musicQuality: string;
  musicEdits: MusicEdits;
  musicCollection?: Parameters<typeof withMusicContext>[3];
};

export type SavedPlaylistRow = {
  entry: PlaylistEntry;
  selected: boolean;
  analysisState: "pending" | "analyzing" | "ready" | "requiresAuth" | "unavailable" | "temporaryError" | "error";
  media?: MediaInfo | null;
};

export type CollectionWorkspace = {
  kind: "collection";
  url: string;
  playlist: PlaylistInfo | null;
  rows: SavedPlaylistRow[];
  params: Omit<PlaylistParameters, "audioEncoders">;
  musicEdits: Record<string, MusicEdits>;
  albumEdits: MusicEdits;
  createAlbumFolder: boolean;
  layout: "wide" | "stacked";
};

export type WorkspaceView = SingleWorkspace | CollectionWorkspace;
export type Workspace = {
  version: 1;
  activeSection: DownloadSection;
  urls: { new: string; playlist: string; music: string };
  views: Partial<Record<WorkspaceKey, WorkspaceView>>;
};

export function emptyWorkspace(): Workspace {
  return { version: 1, activeSection: "new", urls: { new: "", playlist: "", music: "" }, views: {} };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validMedia(value: unknown): boolean {
  return value === null || record(value) && typeof value.title === "string"
    && ["uploader", "originalLanguage", "webpageUrl", "thumbnail", "description", "uploadDate"].every((key) => value[key] == null || typeof value[key] === "string")
    && ["duration", "viewCount"].every((key) => value[key] == null || typeof value[key] === "number")
    && (value.music == null || validEdits(value.music))
    && Array.isArray(value.videoFormats) && Array.isArray(value.audioFormats)
    && [...value.videoFormats, ...value.audioFormats].every((format) => record(format)
      && typeof format.formatId === "string" && typeof format.qualityLabel === "string"
      && (format.kind === "video" || format.kind === "audio")
      && ["ext", "codec", "dynamicRange"].every((key) => format[key] == null || typeof format[key] === "string"))
    && (value.subtitles == null || Array.isArray(value.subtitles) && value.subtitles.every((item) => record(item)
      && typeof item.language === "string" && typeof item.automatic === "boolean" && Array.isArray(item.formats) && item.formats.every((format) => typeof format === "string")));
}

function validEdits(value: unknown): boolean {
  return record(value) && Object.entries(value).every(([key, item]) =>
    key === "trackNumber" ? item === null || typeof item === "number"
      : ["title", "artist", "album", "albumArtist", "year"].includes(key) && typeof item === "string");
}

function validEntry(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && typeof value.url === "string"
    && typeof value.title === "string" && typeof value.index === "number"
    && (value.thumbnail == null || typeof value.thumbnail === "string")
    && (value.duration == null || typeof value.duration === "number");
}

function validView(value: unknown): value is WorkspaceView {
  if (!record(value) || typeof value.url !== "string") return false;
  if (value.kind === "single") return validMedia(value.media)
    && ["video", "audio", "subtitles"].includes(String(value.mode))
    && ["bestVideo", "mp4Video", "audioMp3", "audioM4a", "audioOpus", "audioSource", "audioFlac", "subtitles"].includes(String(value.preset))
    && ["destinationDir", "videoProfile", "audioBitrate", "audioChannels", "musicQuality"].every((key) => typeof value[key] === "string")
    && ["selectedVideoFormatId", "selectedAudioFormatId", "selectedSubtitleKey", "selectedSubtitleFormat"].every((key) => value[key] === null || typeof value[key] === "string")
    && typeof value.embedMetadata === "boolean" && typeof value.embedThumbnail === "boolean" && validEdits(value.musicEdits);
  return value.kind === "collection" && record(value.params) && typeof value.params.destinationDir === "string"
    && ["video", "audio", "subtitles"].includes(String(value.params.mode))
    && Object.entries(defaultPlaylistParameters).every(([key, item]) => {
      const saved = (value.params as Record<string, unknown>)[key];
      if (key === "resolution") return saved === "best" || typeof saved === "number" && Number.isFinite(saved) && saved > 0;
      if (key === "fps") return saved === null || typeof saved === "number" && Number.isFinite(saved) && saved > 0;
      return item === null ? saved === null || typeof saved === "string" : typeof saved === typeof item;
    })
    && (value.layout === "wide" || value.layout === "stacked") && typeof value.createAlbumFolder === "boolean"
    && record(value.musicEdits) && Object.values(value.musicEdits).every(validEdits) && validEdits(value.albumEdits)
    && (value.playlist === null || record(value.playlist) && typeof value.playlist.title === "string" && Array.isArray(value.playlist.entries) && value.playlist.entries.every(validEntry))
    && Array.isArray(value.rows) && value.rows.every((row) => record(row) && validEntry(row.entry)
      && typeof row.selected === "boolean"
      && ["pending", "analyzing", "ready", "requiresAuth", "unavailable", "temporaryError", "error"].includes(String(row.analysisState))
      && validMedia(row.media ?? null));
}

export function loadWorkspace(): Workspace | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(workspaceStorageKey) ?? "null");
    if (!record(value) || value.version !== 1 || !record(value.urls) || !record(value.views)
      || !["new", "playlist", "music"].includes(String(value.activeSection))
      || !["new", "playlist", "music"].every((key) => typeof (value.urls as Record<string, unknown>)[key] === "string")) return null;
    const restored = emptyWorkspace();
    restored.activeSection = value.activeSection as DownloadSection;
    restored.urls = { new: String(value.urls.new), playlist: String(value.urls.playlist), music: String(value.urls.music) };
    for (const key of ["new", "playlist", "musicSingle", "musicCollection"] as const) {
      const view = value.views[key];
      const url = restored.urls[key.startsWith("music") ? "music" : key as "new" | "playlist"];
      if (validView(view) && view.url === url && view.kind === (key === "new" || key === "musicSingle" ? "single" : "collection")) {
        restored.views[key] = view.kind === "collection" ? {
          ...view, rows: view.rows.map((row) => ({
            entry: row.entry, selected: row.selected,
            analysisState: row.analysisState === "analyzing" ? "pending" : row.analysisState,
            media: row.media ?? null,
          })),
        } : view;
      }
    }
    return restored;
  } catch { return null; }
}

export function saveWorkspace(workspace: Workspace): boolean {
  try { window.localStorage.setItem(workspaceStorageKey, JSON.stringify(workspace)); return true; }
  catch { return false; }
}

export function clearWorkspace() {
  try { window.localStorage.removeItem(workspaceStorageKey); } catch { /* Storage can be unavailable. */ }
}
