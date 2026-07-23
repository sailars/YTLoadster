import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n";

export type SummaryFact = { label: string; value: ReactNode };
type Props = {
  tags?: string[];
  facts: SummaryFact[];
  destinationDir: string;
  onDestinationChange: (value: string) => void;
  onBrowse: () => void;
  buttonAriaLabel: string;
  disabled: boolean;
  busy: boolean;
  analyzed: boolean;
  error?: string | null;
};

export function DownloadSummaryCard({ tags = [], facts, destinationDir, onDestinationChange, onBrowse, buttonAriaLabel, disabled, busy, analyzed, error = null }: Props) {
  const { t } = useI18n();
  const [isAnimating, setIsAnimating] = useState(false);
  const animationTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (animationTimer.current !== null) window.clearTimeout(animationTimer.current);
  }, []);

  function animateDownload() {
    if (disabled) return;
    if (animationTimer.current !== null) window.clearTimeout(animationTimer.current);
    setIsAnimating(true);
    animationTimer.current = window.setTimeout(() => {
      setIsAnimating(false);
      animationTimer.current = null;
    }, 820);
  }

  return <section className="download-summary-card" aria-label={t("common.finalFile")}>
    <header><h3>{t("common.finalFile")}</h3>{tags.length ? <div className="summary-tags" aria-label={t("video.qualityTags")}>{tags.map((tag) => <span key={tag} className="summary-tag">{tag}</span>)}</div> : null}</header>
    <dl className="summary-facts">{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
    <div className="summary-divider" />
    <label className="summary-destination"><span>{t("downloader.destination")}</span><div className="destination-row"><input aria-label={t("downloader.destination")} value={destinationDir} onChange={(event) => onDestinationChange(event.target.value)} /><button type="button" className="secondary" onClick={onBrowse}>{t("downloader.browse")}</button></div></label>
    <button
      className="download-action"
      type="submit"
      aria-label={buttonAriaLabel}
      aria-busy={busy}
      data-analyzed={analyzed}
      data-animating={isAnimating}
      disabled={disabled}
      onClick={animateDownload}
    >
      <DownloadActionIcon />
      <span className="download-action-label">{t("downloader.downloadAction")}</span>
    </button>
    {error ? <p className="download-action-error" role="alert">{error}</p> : null}
  </section>;
}

function DownloadActionIcon() {
  return (
    <svg className="download-action-icon" aria-hidden="true" viewBox="0 0 32 32" focusable="false">
      <g className="download-action-arrow">
        <path className="download-action-shaft" d="M16 4.5v13" />
        <path className="download-action-chevron" d="m10.5 13.5 5.5 5.5 5.5-5.5" />
      </g>
      <path className="download-action-tray" d="M7 24.5h18" />
      <g className="download-action-particles">
        <path d="M8.5 18.5 5.8 16.8" />
        <path d="m23.5 18.5 2.7-1.7" />
        <path d="m10 21.2-3.2.4" />
        <path d="m22 21.2 3.2.4" />
        <path d="M12.2 18.2 11 15.4" />
        <path d="m19.8 18.2 1.2-2.8" />
      </g>
    </svg>
  );
}
