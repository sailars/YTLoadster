import type { ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import { AudioWaveIcon } from "../downloader/AudioWaveIcon";
import { DownloadActionButton, type DownloadActionButtonProps, type SummaryFact } from "../downloader/DownloadSummaryCard";

type Props = {
  count: number;
  countLabel?: string;
  countIcon?: ReactNode;
  video: boolean;
  sourceQuality?: boolean;
  size: ReactNode;
  facts: SummaryFact[];
  destinationDir: string;
  onDestinationChange: (value: string) => void;
  onBrowse: () => void;
  action: DownloadActionButtonProps;
  children?: ReactNode;
};

export function MusicDownloadSummary({ count, countLabel, countIcon, video, sourceQuality = true, size, facts, destinationDir, onDestinationChange, onBrowse, action, children }: Props) {
  const { t } = useI18n();
  const detailTitle = facts.map((fact) => typeof fact.value === "string" || typeof fact.value === "number" ? `${fact.label}: ${fact.value}` : fact.label).join(" · ");
  const displayedCount = countLabel ?? t(video ? "music.clipCount" : "music.trackCount", { count });
  return <section className="download-summary-card music-download-summary" aria-label={t("common.finalFile")}>
    <div className="music-summary-details">
      <dl className="music-summary-facts">
        <div className="music-summary-count">
          <dt>{countIcon ?? <MusicNoteIcon />}<span title={displayedCount}>{displayedCount}</span></dt><dd>{size}</dd>
        </div>
        {facts.slice(0, 2).map((fact, index) => <div key={fact.label}>
          <dt>{index === 0 ? video ? <MediaContainerIcon /> : <AudioWaveIcon /> : video ? <ResolutionIcon /> : sourceQuality ? <SourceQualityIcon /> : <SignalIcon />}<span title={fact.label}>{fact.label}</span></dt><dd title={detailTitle}>{fact.value}</dd>
        </div>)}
      </dl>
      <div className="music-summary-destination">
        <FolderIcon />
        <label><span>{t("downloader.destination")}</span><input aria-label={t("downloader.destination")} title={destinationDir} value={destinationDir} onChange={(event) => onDestinationChange(event.target.value)} /></label>
        <button type="button" className="secondary" onClick={onBrowse}>{t("music.changeFolder")}</button>
      </div>
    </div>
    <DownloadActionButton {...action} />
    {children}
  </section>;
}

function MusicNoteIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l11-2v13M9 8l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" /></svg>;
}

function MediaContainerIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5 6.5 3h11L21 8.5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM3 8.5h18M6.5 3v5.5M17.5 3v5.5" /><path d="m10 12 5 3-5 3Z" /></svg>;
}

function SourceQualityIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 13V11a7.5 7.5 0 0 1 15 0v2M4.5 12H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h.5ZM19.5 12h.5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-.5Z" /><path d="m8.5 13.5 2.5 2.5 4.5-5" /></svg>;
}

function ResolutionIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M6 10V8h2M6 8l3 3M18 10V8h-2M18 8l-3 3M6 14v2h2M6 16l3-3M18 14v2h-2M18 16l-3-3" /></svg>;
}

function SignalIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h5l3-9 4 18 3-9h5" /></svg>;
}

function FolderIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>;
}
