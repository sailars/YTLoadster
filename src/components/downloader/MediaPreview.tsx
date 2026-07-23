import type { MediaInfo } from "../../lib/types";
import { useI18n, type Translate } from "../../lib/i18n";

type Props = {
  url: string;
  media: MediaInfo | null;
  error: string | null;
  isAnalyzing: boolean;
  onUrlChange: (value: string) => void;
  onPaste: () => void;
  onClear: () => void;
  onOpen: () => void;
  onCopy: () => void;
};

export function MediaPreview({
  url,
  media,
  error,
  isAnalyzing,
  onUrlChange,
  onPaste,
  onClear,
  onOpen,
  onCopy,
}: Props) {
  const { locale, t } = useI18n();
  return (
    <div className="media-column">
      <label className="input-label" htmlFor="video-url">
        {t("media.url")}
      </label>
      <div className="url-row">
        <input
          id="video-url"
          value={url}
          data-has-url={Boolean(url.trim())}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder={t("media.placeholder")}
        />
        <button type="button" className="icon-button url-action-button" aria-label={t("media.paste")} title={t("media.paste")} onClick={onPaste}>
          <PasteIcon />
        </button>
        <button
          type="button"
          className="icon-button url-action-button"
          aria-label={t("media.clear")}
          title={t("media.clear")}
          onClick={onClear}
          disabled={!url.trim()}
        >
          <ClearIcon />
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {isAnalyzing ? <p className="analysis-status">{t("media.analyzing")}</p> : null}

      {media ? (
        <div className="media-card">
          {media.thumbnail ? (
            <img className="media-thumbnail" src={media.thumbnail} alt={t("media.preview")} />
          ) : (
            <div className="media-thumbnail placeholder" aria-hidden="true" />
          )}
          <div className="media-copy">
            <h2>{media.title}</h2>
            <p className="media-meta">{mediaMeta(media, locale, t)}</p>
            {media.description ? <p className="media-description">{trimDescription(media.description)}</p> : null}
          </div>
          <div className="media-actions" aria-label={t("media.actions")}>
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
        <div className="media-empty" aria-live="polite">
          <div className="media-empty-icon" aria-hidden="true"><VideoIcon /></div>
          <strong>{t("media.emptyTitle")}</strong>
          <span>{t("media.emptyText")}</span>
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

function PasteIcon() {
  return (
    <svg className="url-action-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 5H6.75A2.25 2.25 0 0 0 4.5 7.25v12A2.25 2.25 0 0 0 6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25V7.25A2.25 2.25 0 0 0 17.25 5H16" />
      <rect x="8" y="2.75" width="8" height="4.5" rx="1.5" />
      <path d="M8.5 11.5h7" />
      <path d="M8.5 15.5h5" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg className="url-action-icon clear-url-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M7 7l10 10" />
      <path d="M17 7 7 17" />
    </svg>
  );
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
