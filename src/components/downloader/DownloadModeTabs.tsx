import { useI18n } from "../../lib/i18n";
import { AudioWaveIcon } from "./AudioWaveIcon";

export type DownloadMode = "video" | "audio" | "subtitles";

export function DownloadModeTabs({ mode, onChange }: { mode: DownloadMode; onChange: (mode: DownloadMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="mode-tabs" role="tablist" aria-label={t("downloader.mode")}>
      <button type="button" role="tab" aria-label={t("downloader.video")} className="mode-tab" aria-selected={mode === "video"} onClick={() => onChange("video")}>
        <span className="mode-tab-icon"><VideoIcon /></span>
        <strong>{t("downloader.video")}</strong>
      </button>
      <button type="button" role="tab" aria-label={t("downloader.audio")} className="mode-tab" aria-selected={mode === "audio"} onClick={() => onChange("audio")}>
        <span className="mode-tab-icon"><AudioWaveIcon /></span>
        <strong>{t("downloader.audio")}</strong>
      </button>
      <button type="button" role="tab" aria-label={t("downloader.subtitles")} className="mode-tab" aria-selected={mode === "subtitles"} onClick={() => onChange("subtitles")}>
        <span className="mode-tab-icon"><SubtitleIcon /></span>
        <strong>{t("downloader.subtitles")}</strong>
      </button>
    </div>
  );
}

function VideoIcon() {
  return (
    <svg className="mode-icon-outline" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.75" y="5" width="18.5" height="14" rx="2.5" />
      <path className="mode-icon-solid" d="m10 9 5 3-5 3V9Z" />
    </svg>
  );
}

function SubtitleIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5v-11A2.5 2.5 0 0 1 4.5 4ZM5 9v2h6V9H5Zm8 0v2h6V9h-6Zm-8 4v2h4v-2H5Zm6 0v2h8v-2h-8Z" /></svg>;
}
