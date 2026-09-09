import { useEffect, useMemo, useState } from "react";

type Props = {
  src?: string | null;
  mediaUrl?: string | null;
  alt: string;
  className: string;
  placeholderClassName: string;
};

export function MediaThumbnail({ src, mediaUrl, alt, className, placeholderClassName }: Props) {
  const candidates = useMemo(() => thumbnailCandidates(src, mediaUrl), [src, mediaUrl]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates]);

  const candidate = candidates[candidateIndex];
  if (!candidate) return <div className={placeholderClassName} aria-hidden="true" />;

  return (
    <img
      className={className}
      src={candidate}
      alt={alt}
      decoding="async"
      fetchPriority="high"
      referrerPolicy="no-referrer"
      onError={() => setCandidateIndex((current) => current + 1)}
    />
  );
}

export function thumbnailCandidates(src?: string | null, mediaUrl?: string | null) {
  const candidates: string[] = [];
  if (src?.trim()) candidates.push(src.trim());
  const videoId = youtubeVideoId(mediaUrl) ?? youtubeVideoId(src);
  if (videoId) {
    candidates.push(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
    candidates.push(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
  }
  return [...new Set(candidates)];
}

function youtubeVideoId(value?: string | null) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    }
    if (host === "i.ytimg.com" || host.endsWith(".ytimg.com")) {
      return parsed.pathname.match(/\/vi(?:_webp)?\/([^/]+)/)?.[1] ?? null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const queryId = parsed.searchParams.get("v");
      if (queryId) return queryId;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0] ?? "")) return parts[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}
