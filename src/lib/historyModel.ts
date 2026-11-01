import type { DownloadRequest, HistoryItem, SubtitleSelection } from "./types";

function sourceKey(value: string) {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    let id: string | undefined;
    if (host === "youtu.be") id = parts[0];
    else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (parts[0] === "watch") id = url.searchParams.get("v")?.trim();
      else if (["shorts", "embed", "live", "v"].includes(parts[0])) id = parts[1];
    }
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? `youtube:${id}` : null;
  } catch { return null; }
}

type HistorySource = { url: string; canonicalSource?: string | null; preset: string; subtitle?: SubtitleSelection | null };

export function historyKeyForSource(request: HistorySource) {
  const source = sourceKey(request.canonicalSource ?? "") ?? sourceKey(request.url);
  if (!source) return null;
  const kind = ["bestVideo", "mp4Video"].includes(request.preset) ? "video"
    : ["audioMp3", "audioM4a", "audioOpus", "audioSource", "audioFlac"].includes(request.preset) ? "audio"
      : request.preset === "subtitles" ? "subtitles" : null;
  if (!kind) return null;
  const parts = [source, kind];
  if (kind === "subtitles" && request.subtitle) {
    parts.push(request.subtitle.language.trim().toLowerCase(), request.subtitle.automatic ? "automatic" : "manual");
  }
  return JSON.stringify(parts);
}

export function historyKeysFromItems(items: HistoryItem[]) {
  return new Set(items.map((item) => item.historyKey ?? historyKeyForSource(item.request ?? item)).filter((key): key is string => Boolean(key)));
}

export function historyContainsRequest(keys: Set<string>, request: DownloadRequest) {
  const key = historyKeyForSource(request);
  if (key && keys.has(key)) return true;
  // Older subtitle records may have no saved language. Preserve that warning too.
  const legacyKey = request.preset === "subtitles" ? historyKeyForSource({ ...request, subtitle: null }) : null;
  return Boolean(legacyKey && keys.has(legacyKey));
}
