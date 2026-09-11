export type YoutubeSourceKind = "invalid" | "video" | "playlist" | "mixed";

export function classifyYoutubeSource(value: string): YoutubeSourceKind {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "youtu.be" && host !== "youtube.com" && !host.endsWith(".youtube.com")) {
      return "invalid";
    }

    const list = url.searchParams.get("list")?.trim();
    const video = url.searchParams.get("v")?.trim();
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
  return `https://www.youtube.com/watch?v=${encodeURIComponent(video)}`;
}
