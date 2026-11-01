import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { musicAudioFormats, musicConversionAvailable, type MusicAudioPreset, type MusicEdits } from "../../lib/musicModel";
import type { FormatOption, MusicMetadata } from "../../lib/types";
import { ParameterSelect } from "../ParameterSelect";
import { AudioWaveIcon } from "../downloader/AudioWaveIcon";

export function MusicParametersGroup({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? <div className="music-parameters-group">{children}</div> : <>{children}</>;
}

export function MusicModeTabs({ mode, onChange }: { mode: string; onChange: (mode: "audio" | "video") => void }) {
  const { t } = useI18n();
  return <div className="mode-tabs music-mode-tabs" role="tablist" aria-label={t("downloader.mode")}>
    {(["audio", "video"] as const).map((value) => <button key={value} type="button" role="tab" className="mode-tab" aria-selected={mode === value} onClick={() => onChange(value)}>
      <span className="mode-tab-icon">{value === "audio" ? <TrackModeIcon /> : <ClipModeIcon />}</span>
      <strong>{t(value === "audio" ? "music.track" : "music.clip")}</strong>
    </button>)}
  </div>;
}

function TrackModeIcon() {
  return <svg className="mode-icon-outline" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 13V11a7.5 7.5 0 0 1 15 0v2M4.5 12H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h.5ZM19.5 12h.5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5Z" />
    <path className="mode-icon-solid" d="M10.5 10.2a.6.6 0 0 0-.9.5v6.6a.6.6 0 0 0 .9.5l5-3.3a.6.6 0 0 0 0-1Z" />
  </svg>;
}

function ClipModeIcon() {
  return <svg className="mode-icon-outline" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 16H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v1" />
    <rect x="6" y="7" width="16" height="14" rx="1.5" />
    <path className="mode-icon-solid" d="M12.1 10.3a.6.6 0 0 0-.9.5v6.4a.6.6 0 0 0 .9.5l4.8-3.2a.6.6 0 0 0 0-1Z" />
  </svg>;
}

export function MusicMetadataEditor({ value, onChange, onReset, albumOnly = false, children }: { value: MusicMetadata; onChange: (patch: MusicEdits) => void; onReset: () => void; albumOnly?: boolean; children?: ReactNode }) {
  const { t } = useI18n();
  const fields = albumOnly ? ["albumArtist", "album", "year"] as const : ["title", "artist", "album", "year"] as const;
  return <section className="music-tags" aria-label={t("music.tags")}>
    <div className="music-tags-heading"><h3><MetadataTagIcon />{t("music.tags")}</h3><button type="button" className="icon-button secondary" title={t("music.resetTags")} aria-label={t("music.resetTags")} onClick={onReset}>↺</button></div>
    <div className="music-tag-fields">{fields.map((field) => <label key={field} className={`music-tag-field-${field}`}><span>{t(`music.${field}`)}</span><input value={value[field]} inputMode={field === "year" ? "numeric" : undefined} maxLength={field === "year" ? 4 : 500} onChange={(event) => onChange({ [field]: field === "year" ? event.target.value.replace(/\D/g, "") : event.target.value })} /></label>)}</div>
    {children}
  </section>;
}

export function MusicAlbumFolderOption({ baseDir, albumArtist, album, checked, disabled, error, onChange }: {
  baseDir: string; albumArtist: string; album: string; checked: boolean; disabled: boolean; error: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setPreview(null);
    void api.previewAlbumDestination(baseDir, albumArtist, album, checked)
      .then((path) => { if (current) setPreview(path); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [baseDir, albumArtist, album, checked]);
  return <div className="music-album-folder-option">
    <label className="checkbox-label"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{t("music.createAlbumFolder")}</span></label>
    {preview ? <output aria-label={t("music.destinationPreview")} title={preview}>{preview}</output> : null}
    {error ? <p className="error" role="alert">{t("music.folderSaveError")}</p> : null}
  </div>;
}

function MetadataTagIcon() {
  return <svg className="music-metadata-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.2 3H19a2 2 0 0 1 2 2v5.8a2 2 0 0 1-.6 1.4l-8.2 8.2a2 2 0 0 1-2.8 0l-6.8-6.8a2 2 0 0 1 0-2.8l9.2-7.4a2 2 0 0 1 1.4-.4Z" />
    <circle cx="16.5" cy="7.5" r="1.5" />
  </svg>;
}

type AudioProps = {
  preset: MusicAudioPreset; bitrate: string; quality: string; embedMetadata: boolean; embedThumbnail: boolean;
  formats: FormatOption[]; encoders: string[] | null;
  onPreset: (preset: MusicAudioPreset) => void; onBitrate: (value: string) => void; onQuality: (value: string) => void;
  onMetadata: (value: boolean) => void; onThumbnail: (value: boolean) => void;
};

export function MusicAudioOptions(props: AudioProps) {
  const { t } = useI18n();
  const options = (["audioSource", "audioMp3", "audioM4a", "audioOpus", "audioFlac"] as const).map((preset) => {
    const disabled = props.formats.length > 0 && !musicConversionAvailable(preset, musicAudioFormats(props.formats, preset)[0], props.encoders);
    return { value: preset,
      label: preset === "audioSource" ? t("music.original") : preset.replace("audio", "").toUpperCase(),
      disabled, title: disabled ? t("music.encoderUnavailable") : undefined,
    };
  });
  return <section className="advanced-settings audio-advanced-settings playlist-audio-settings music-audio-options" aria-label={t("audio.settings")}>
    <div className="settings-title audio-title"><AudioWaveIcon /><h3>{t("audio.settings")}</h3></div>
    <div className="settings-grid music-audio-fields">
      <label className="playlist-param"><span>{t("audio.codec")}</span><ParameterSelect label={t("audio.codec")} value={props.preset} options={options} onChange={(value) => props.onPreset(value as MusicAudioPreset)} /></label>
      <label className="playlist-param"><span>{t("music.sourceQuality")}</span><ParameterSelect label={t("music.sourceQuality")} value={props.quality} options={[{ value: "best", label: t("music.best") }, ...[256, 192, 128, 64, 48].map((value) => ({ value: String(value), label: t("music.upTo", { bitrate: value }) }))]} onChange={props.onQuality} /></label>
      {props.preset === "audioMp3" ? <label className="playlist-param"><span>{t("audio.bitrate")}</span><ParameterSelect label={t("audio.bitrate")} value={props.bitrate} options={["320K", "256K", "192K", "128K"].map((value) => ({ value, label: value.replace("K", " kbps") }))} onChange={props.onBitrate} /></label> : null}
    </div>
    {props.preset === "audioFlac" ? <p className="music-format-note">{t("music.flacNotice")}</p> : null}
    <div className="toggle-list playlist-toggle-list"><label className="switch-row"><span>{t("audio.metadata")}</span><input type="checkbox" checked={props.embedMetadata} onChange={(event) => props.onMetadata(event.target.checked)} /></label><label className="switch-row"><span>{t("audio.thumbnail")}</span><input type="checkbox" checked={props.embedThumbnail} onChange={(event) => props.onThumbnail(event.target.checked)} /></label></div>
  </section>;
}
