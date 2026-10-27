import type { MediaInfo } from "../../lib/types";
import { useI18n, type Translate } from "../../lib/i18n";
import { MediaThumbnail } from "../MediaThumbnail";
import { musicMetadata } from "../../lib/musicModel";
import { YouTubeMusicIcon } from "../YouTubeMusicIcon";

type Props = {
  music?: boolean;
  url: string;
  media: MediaInfo | null;
  onOpen: () => void;
  onCopy: () => void;
};

export function MediaPreview({
  music = false,
  url,
  media,
  onOpen,
  onCopy,
}: Props) {
  const { locale, t } = useI18n();
  return (
    <div className="media-column">
      {media ? (
        <div className="media-card">
          <MediaThumbnail
            zoomable={music}
            src={media.thumbnail}
            mediaUrl={media.webpageUrl || url}
            alt={music ? musicMetadata(media).title : t("media.preview")}
            className="media-thumbnail"
            placeholderClassName="media-thumbnail placeholder"
          />
          <div className="media-copy">
            <h2>{music ? musicMetadata(media).title : media.title}</h2>
            <p className="media-meta">{music ? musicMetadata(media).artist : mediaMeta(media, locale, t)}</p>
            {music ? <p className="media-meta">{[musicMetadata(media).album, musicMetadata(media).year, media.duration != null ? `${Math.floor(media.duration / 60)}:${String(media.duration % 60).padStart(2, "0")}` : null].filter(Boolean).join(" · ")}</p> : media.description ? <p className="media-description">{trimDescription(media.description)}</p> : null}
          </div>
          <div className="media-actions" hidden={music} aria-label={t("media.actions")}>
            <button type="button" className="icon-text-button secondary" onClick={onOpen}>
              <ExternalLinkIcon />
              <span>{t("media.open")}</span>
            </button>
            <button type="button" className="icon-text-button secondary" onClick={onCopy}>
              <CopyIcon />
              <span>{t("media.copy")}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="section-empty playlist-empty source-empty" aria-live="polite">
          {music ? <YouTubeMusicIcon /> : <VideoIcon />}
          <strong>{t(music ? "nav.music" : "media.emptyPreviewTitle")}</strong>
          <span>{t(music ? "music.empty" : "media.emptyText")}</span>
        </div>
      )}
    </div>
  );
}

function mediaMeta(media: MediaInfo, locale: "ru" | "en", t: Translate) {
  return [media.uploader, formatUploadDate(media.uploadDate, locale), formatViewCount(media.viewCount, locale, t)]
    .filter(Boolean)
    .join(" • ");
}

function formatUploadDate(value: string | null | undefined, locale: "ru" | "en") {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`);
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }
  return value;
}

function formatViewCount(value: number | null | undefined, locale: "ru" | "en", t: Translate) {
  return typeof value === "number"
    ? t("media.views", { count: new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US").format(value) })
    : null;
}

function trimDescription(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 190 ? `${normalized.slice(0, 187)}...` : normalized;
}

function ExternalLinkIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></svg>;
}

function CopyIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M8 7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-1v-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v1H8V7Zm-5 4a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7Zm3-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H6Z" /></svg>;
}

function VideoIcon() {
  return (
    <svg className="empty-video-icon" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.75" y="5" width="18.5" height="14" rx="2.5" />
      <path className="icon-solid" d="m10 9 5 3-5 3V9Z" />
    </svg>
  );
}
