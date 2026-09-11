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

export type DownloadActionButtonProps = {
  ariaLabel: string;
  busy?: boolean;
  analyzed: boolean;
  className?: string;
  disabled: boolean;
  label: string;
  onClick?: () => void;
  type?: "button" | "submit";
};

const downloadActionAnimationDurationMs = 980;

export function DownloadSummaryCard({ tags = [], facts, destinationDir, onDestinationChange, onBrowse, buttonAriaLabel, disabled, busy, analyzed, error = null }: Props) {
  const { t } = useI18n();

  return <section className="download-summary-card" aria-label={t("common.finalFile")}>
    <header><h3>{t("common.finalFile")}</h3>{tags.length ? <div className="summary-tags" aria-label={t("video.qualityTags")}>{tags.map((tag) => <span key={tag} className="summary-tag">{tag}</span>)}</div> : null}</header>
    <dl className="summary-facts">{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd className="summary-fact-value">{fact.value}</dd></div>)}</dl>
    <div className="summary-divider" />
    <label className="summary-destination"><span>{t("downloader.destination")}</span><div className="destination-row"><input aria-label={t("downloader.destination")} value={destinationDir} onChange={(event) => onDestinationChange(event.target.value)} /><button type="button" className="secondary" onClick={onBrowse}>{t("downloader.browse")}</button></div></label>
    <DownloadActionButton
      ariaLabel={buttonAriaLabel}
      busy={busy}
      analyzed={analyzed}
      disabled={disabled}
      label={t("downloader.downloadAction")}
    />
    {error ? <p className="download-action-error" role="alert">{error}</p> : null}
  </section>;
}

export function DownloadActionButton({
  ariaLabel,
  busy = false,
  analyzed,
  className,
  disabled,
  label,
  onClick,
  type = "submit",
}: DownloadActionButtonProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const animationTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (animationTimer.current !== null) window.clearTimeout(animationTimer.current);
  }, []);

  function handleClick() {
    if (disabled) return;
    if (animationTimer.current !== null) window.clearTimeout(animationTimer.current);
    setIsAnimating(true);
    animationTimer.current = window.setTimeout(() => {
      setIsAnimating(false);
      animationTimer.current = null;
    }, downloadActionAnimationDurationMs);
    onClick?.();
  }

  return (
    <button
      className={className ? `download-action ${className}` : "download-action"}
      type={type}
      aria-label={ariaLabel}
      aria-busy={busy}
      data-analyzed={analyzed}
      data-animating={isAnimating}
      disabled={disabled}
      onClick={handleClick}
    >
      <DownloadActionIcon />
      <span className="download-action-label">{label}</span>
    </button>
  );
}

function DownloadActionIcon() {
  return (
    <svg className="download-action-icon" aria-hidden="true" viewBox="0 0 32 32" focusable="false">
      <g className="download-action-arrow">
        <path className="download-action-shaft" d="M16 4.5v13" />
        <path className="download-action-chevron" d="m10.5 13.5 5.5 5.5 5.5-5.5" />
      </g>
      <path className="download-action-tray download-action-tray-flat" d="M7 24.5h18" />
      <path className="download-action-tray download-action-tray-bend" d="M7 24.5c3.2 0 4.7 3.5 9 3.5s5.8-3.5 9-3.5" />
      <g className="download-action-particles">
        <circle className="download-action-particle particle-left" cx="13.5" cy="22" r="1" />
        <circle className="download-action-particle particle-right" cx="18.5" cy="22" r="1" />
        <circle className="download-action-particle particle-top" cx="16" cy="20" r="0.9" />
        <path className="download-action-particle particle-left-splash" d="m14.4 23.5-1.6 1.4" />
        <path className="download-action-particle particle-right-splash" d="m17.6 23.5 1.6 1.4" />
      </g>
    </svg>
  );
}
