export type YoutubeSourceKind = "invalid" | "video" | "playlist" | "mixed";

export function classifyYoutubeSource(value: string): YoutubeSourceKind {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return "invalid";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "youtu.be" && host !== "youtube.com" && !host.endsWith(".youtube.com")) {
      return "invalid";
    }

    const list = url.searchParams.get("list")?.trim();
    const video = url.searchParams.get("v")?.trim();
    if (host === "music.youtube.com" && /^\/browse\/(?:MP|VL)/.test(url.pathname)) return "playlist";
    if (list && video) return "mixed";
    if (list || url.pathname.toLowerCase() === "/playlist") return "playlist";
    return "video";
  } catch {
    return "invalid";
  }
}

export function videoUrlFromMixedSource(value: string) {
  const url = new URL(value.trim());
  const video = url.searchParams.get("v");
  if (!video) return value.trim();
  const host = isYoutubeMusicUrl(value) ? "music.youtube.com" : "www.youtube.com";
  return `https://${host}/watch?v=${encodeURIComponent(video)}`;
}

export function isYoutubeMusicUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && url.hostname.toLowerCase() === "music.youtube.com";
  } catch { return false; }
}

export function musicSourceKind(value: string): YoutubeSourceKind | "unsupported" | "channel" | "radio" {
  if (!isYoutubeMusicUrl(value)) return "invalid";
  const url = new URL(value.trim());
  const list = url.searchParams.get("list");
  if (list?.startsWith("RD")) return "radio";
  if (!list && !url.searchParams.get("v")) {
    if (/^\/(?:@[^/]+|channel\/[^/]+|browse\/UC[^/]+)(?:\/|$)/.test(url.pathname)) return "channel";
    if (!/^\/browse\/(MP|VL)/.test(url.pathname)) return "unsupported";
  }
  return classifyYoutubeSource(value);
}
