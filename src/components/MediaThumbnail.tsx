import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../lib/i18n";

type Props = {
  zoomable?: boolean;
  src?: string | null;
  mediaUrl?: string | null;
  alt: string;
  className: string;
  placeholderClassName: string;
};

export function MediaThumbnail({ src, mediaUrl, alt, className, placeholderClassName, zoomable = false }: Props) {
  const { t } = useI18n();
  const candidates = useMemo(() => thumbnailCandidates(src, mediaUrl), [src, mediaUrl]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates]);

  useEffect(() => {
    setOpen(false);
  }, [src, mediaUrl]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); close();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [open]);

  const candidate = candidates[candidateIndex];
  if (!candidate) return <div className={placeholderClassName} aria-hidden="true" />;

  const thumbnail = (
    <img
      className={zoomable ? "thumbnail-preview-image" : className}
      src={candidate}
      alt={alt}
      decoding="async"
      fetchPriority="high"
      referrerPolicy="no-referrer"
      onError={() => setCandidateIndex((current) => current + 1)}
    />
  );
  if (!zoomable) return thumbnail;
  return <>
    <button ref={trigger} type="button" className={`${className} thumbnail-preview-trigger`}
      aria-label={t("media.viewCover", { title: alt })} title={t("media.viewCover", { title: alt })}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); setOpen(true); }}>{thumbnail}</button>
    {open ? createPortal(
      <div className="dialog-backdrop cover-preview-backdrop" onClick={close}>
        <section className="cover-preview-dialog" role="dialog" aria-modal="true" aria-label={t("media.cover")}
          onClick={(event) => event.stopPropagation()}>
          <header><span>{alt}</span><button type="button" className="icon-button secondary" autoFocus
            aria-label={t("media.closeCover")} onClick={close}
            onKeyDown={(event) => { if (event.key === "Tab") event.preventDefault(); }}>×</button></header>
          <img src={candidate} alt={alt} referrerPolicy="no-referrer" />
        </section>
      </div>, document.body) : null}
  </>;
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
