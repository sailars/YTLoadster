import type { DownloadPreset, FormatOption } from "../../lib/types";
import { useI18n } from "../../lib/i18n";
import { ParameterSelect } from "../ParameterSelect";
import { AudioWaveIcon } from "./AudioWaveIcon";

const bitrateOptions = [
  { value: "320K", label: "320 kbps" },
  { value: "256K", label: "256 kbps" },
  { value: "192K", label: "192 kbps" },
  { value: "128K", label: "128 kbps" },
];

const codecOptions = [
  { value: "audioMp3", label: "MP3" },
  { value: "audioM4a", label: "M4A" },
  { value: "audioOpus", label: "OPUS" },
];

type Props = {
  preset: DownloadPreset;
  bitrate: string;
  channels: string;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  selectedFormat?: FormatOption;
  onPresetChange: (preset: DownloadPreset) => void;
  onBitrateChange: (value: string) => void;
  onChannelsChange: (value: string) => void;
  onEmbedMetadataChange: (value: boolean) => void;
  onEmbedThumbnailChange: (value: boolean) => void;
};

export function AudioDownloadOptions({
  preset,
  bitrate,
  channels,
  embedMetadata,
  embedThumbnail,
  selectedFormat,
  onPresetChange,
  onBitrateChange,
  onChannelsChange,
  onEmbedMetadataChange,
  onEmbedThumbnailChange,
}: Props) {
  const { t } = useI18n();
  const sourceIsMono = selectedFormat?.audioChannels === 1;
  const sourceHasMultipleChannels = (selectedFormat?.audioChannels ?? 0) > 1;
  const channelOptions = [
    { value: "stereo", label: "Stereo", disabled: sourceIsMono, title: sourceIsMono ? t("audio.stereoUnavailable") : undefined },
    { value: "mono", label: "Mono" },
    { value: "source", label: t("audio.sourceChannels") },
  ];

  return (
    <div className="options-stack">
      <section className="advanced-settings audio-advanced-settings" aria-label={t("audio.settings")}>
        <div className="settings-title audio-title">
          <AudioWaveIcon />
          <h3>{t("audio.settings")}</h3>
        </div>
        <div className="settings-grid audio-settings-grid">
          <label>
            <span>{t("audio.bitrate")}</span>
            <ParameterSelect
              label={t("audio.bitrate")}
              value={bitrate}
              options={bitrateOptions}
              onChange={onBitrateChange}
            />
          </label>
          <label>
            <span>{t("video.codec")}</span>
            <ParameterSelect
              label={t("audio.codec")}
              value={preset}
              options={codecOptions}
              onChange={(value) => onPresetChange(value as DownloadPreset)}
            />
          </label>
          <label>
            <span>{t("audio.channels")}</span>
            <ParameterSelect
              label={t("audio.channels")}
              value={channels}
              options={channelOptions}
              onChange={onChannelsChange}
            />
          </label>
        </div>
        {sourceHasMultipleChannels && channels === "mono" ? <p className="audio-channel-warning">{t("audio.monoWarning")}</p> : null}
        <div className="toggle-list">
          <label className="switch-row">
            <span>{t("audio.metadata")}</span>
            <input aria-label={t("audio.metadata")} type="checkbox" checked={embedMetadata} onChange={(event) => onEmbedMetadataChange(event.target.checked)} />
          </label>
          <label className="switch-row">
            <span>{t("audio.thumbnail")}</span>
            <input aria-label={t("audio.thumbnail")} type="checkbox" checked={embedThumbnail} onChange={(event) => onEmbedThumbnailChange(event.target.checked)} />
          </label>
        </div>
      </section>
    </div>
  );
}
