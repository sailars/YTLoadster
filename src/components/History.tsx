import { useRef, useState } from "react";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { matchesPlaylistSearch } from "../lib/playlistSorting";
import type { HistoryItem } from "../lib/types";

type Props = {
  items: HistoryItem[];
  showThumbnails?: boolean;
  onOpenFolder: (path: string) => void;
  onRepeat: (item: HistoryItem) => void;
  onRemove: (id: string) => Promise<void> | void;
  onClear: () => Promise<void> | void;
};

export function History({ items, showThumbnails = true, onOpenFolder, onRepeat, onRemove, onClear }: Props) {
  const { locale, t } = useI18n();
  const [confirmClear, setConfirmClear] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const filteredItems = items.filter((item) => {
    const metadata = item.request?.music?.metadata;
    return matchesPlaylistSearch(search, `${item.title} ${metadata?.title ?? ""}`, `${metadata?.artist ?? ""} ${metadata?.albumArtist ?? ""}`);
  });

  async function remove(id: string) {
    setBusyId(id);
    try {
      await onRemove(id);
    } finally {
      setBusyId(null);
    }
  }

  async function clear() {
    setClearing(true);
    try {
      await onClear();
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="history-panel section-view" aria-label={t("history.label")}>
      <div className="section-heading app-section-heading history-header">
        <div className="history-heading-title">
          <h2>{t("history.label")}</h2>
          <span className="history-count" aria-label={t("history.count", { count: items.length })}>{items.length}</span>
        </div>
        <button type="button" className="secondary" disabled={items.length === 0} onClick={() => setConfirmClear(true)}>
          <TrashIcon />
          {t("history.clear")}
        </button>
      </div>

      {items.length > 0 ? <div className="playlist-search">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        <input ref={searchInput} type="search" aria-label={t("playlist.search")} placeholder={t("playlist.search")}
          value={search} autoComplete="off" spellCheck={false} onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); event.stopPropagation(); setSearch(""); } }} />
        {search ? <><span className="playlist-search-count" role="status">{t("playlist.searchCount", { count: filteredItems.length, total: items.length })}</span>
          <button type="button" className="playlist-search-clear" aria-label={t("playlist.clearSearch")} title={t("playlist.clearSearch")}
            onClick={() => { setSearch(""); searchInput.current?.focus(); }}>×</button></> : null}
      </div> : null}

      {items.length === 0 ? (
        <div className="section-empty history-empty">
          <HistoryIcon />
          <strong>{t("history.emptyTitle")}</strong>
          <span>{t("history.emptyText")}</span>
        </div>
      ) : filteredItems.length === 0 ? <div className="playlist-search-empty" role="status">{t("playlist.searchEmpty")}</div> : (
        <ol className="history-list">
          {filteredItems.map((item) => (
            <li className="history-row" key={item.id} data-no-thumbnail={!showThumbnails || undefined}>
              {showThumbnails ? (item.thumbnail ? <img className="history-thumbnail" src={item.thumbnail} alt="" /> : <div className="history-thumbnail placeholder" />) : null}
              <div className="history-main">
                <strong title={historyTitle(item, t)}>{historyTitle(item, t)}</strong>
                <span className="history-source" title={item.canonicalSource ?? item.url}>{item.canonicalSource ?? item.url}</span>
                <div className="history-meta">
                  <span>{presetLabel(item.preset, t)}</span>
                  {item.formatLabel ? <span>{item.formatLabel}</span> : null}
                  <span>{formatBytes(item.fileSizeBytes, locale, t("common.unknown"))}</span>
                  <time dateTime={dateTimeAttribute(item)}>{formatCompletedAt(item, locale, t("history.unknownDate"))}</time>
                </div>
                {item.outputPath ? <span className="history-path" title={item.outputPath}>{item.outputPath}</span> : null}
              </div>
              <div className="history-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("history.openFolder", { title: historyTitle(item, t) })}
                  title={t("history.openFolderTitle")}
                  disabled={!item.destinationDir && !item.outputPath}
                  onClick={() => {
                    const target = item.destinationDir ?? item.outputPath;
                    if (target) onOpenFolder(target);
                  }}
                >
                  <FolderIcon />
                </button>
                <button type="button" className="icon-button" aria-label={t("history.repeat", { title: historyTitle(item, t) })} title={t("history.repeatTitle")} onClick={() => onRepeat(item)}>
                  <RepeatIcon />
                </button>
                <button
                  type="button"
                  className="icon-button danger-action"
                  aria-label={t("history.remove", { title: historyTitle(item, t) })}
                  title={t("history.removeTitle")}
                  disabled={busyId === item.id}
                  onClick={() => void remove(item.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {confirmClear ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setConfirmClear(false)}>
          <section className="compact-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-history-title">
            <h3 id="clear-history-title">{t("history.clearConfirmTitle")}</h3>
            <p>{t("history.clearConfirmText")}</p>
            <div className="dialog-actions">
              <button type="button" className="secondary" disabled={clearing} onClick={() => setConfirmClear(false)}>{t("common.cancel")}</button>
              <button type="button" className="danger-button" disabled={clearing} onClick={() => void clear()}>{clearing ? t("common.working") : t("history.clear")}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function presetLabel(preset: string, t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  const key = `preset.${preset}` as TranslationKey;
  try {
    return t(key);
  } catch {
    return preset;
  }
}

function historyTitle(item: HistoryItem, t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  return item.title.trim() || t("queue.untitled");
}

function formatBytes(value: number | null | undefined, locale: "ru" | "en", fallback: string) {
  if (value == null) return fallback;
  const units = locale === "ru" ? ["Б", "КБ", "МБ", "ГБ"] : ["B", "KB", "MB", "GB"];
  const unitIndex = value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : value >= 1024 ? 1 : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unitIndex === 0 ? 0 : 1 }).format(value / 1024 ** unitIndex)} ${units[unitIndex]}`;
}

function formatCompletedAt(item: HistoryItem, locale: "ru" | "en", fallback: string) {
  const timestamp = item.completedAtMs ?? parseLegacyDate(item.completedAtLegacy);
  if (timestamp == null) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function dateTimeAttribute(item: HistoryItem) {
  const timestamp = item.completedAtMs ?? parseLegacyDate(item.completedAtLegacy);
  return timestamp == null ? undefined : new Date(timestamp).toISOString();
}

function parseLegacyDate(value?: string | null) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function FolderIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11Zm2.5-.7a.7.7 0 0 0-.7.7V8h14.4a.7.7 0 0 0-.7-.7h-7.25l-2-2H5.5Zm-.7 4v7.7c0 .39.31.7.7.7h13a.7.7 0 0 0 .7-.7V9.8H4.8Z" /></svg>;
}

function RepeatIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.7 5.3 4 11l5.7 5.7 1.27-1.27L7.44 11.9H15a4.2 4.2 0 1 1 0 8.4h-3v1.8h3a6 6 0 1 0 0-12H7.44l3.53-3.53L9.7 5.3Z" /></svg>;
}

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-2 6h12l-1 12H7L6 9Zm3.85 2-.35 8h2l.25-8h-1.9Zm4.3 0h-1.9l.25 8h2l-.35-8Z" /></svg>;
}

function HistoryIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 1-7.3 4.7L2.8 7H8v5.2l-1.8-1.8A6 6 0 1 0 12 6V4Zm-1 3h2v4.6l3.2 2-1.1 1.7-4.1-2.6V7Z" /></svg>;
}
