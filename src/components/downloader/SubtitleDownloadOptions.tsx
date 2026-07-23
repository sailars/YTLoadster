import type { SubtitleOption } from "../../lib/types";
import { useI18n, type Translate } from "../../lib/i18n";
import { ParameterSelect } from "../ParameterSelect";

type Props = {
  subtitles: SubtitleOption[];
  selectedKey: string | null;
  selectedFormat: string | null;
  onSubtitleChange: (subtitle: SubtitleOption) => void;
  onFormatChange: (format: string) => void;
};

export function SubtitleDownloadOptions({
  subtitles,
  selectedKey,
  selectedFormat,
  onSubtitleChange,
  onFormatChange,
}: Props) {
  const { t } = useI18n();
  const selected = subtitles.find((subtitle) => subtitleKey(subtitle) === selectedKey) ?? null;

  if (subtitles.length === 0) {
    return (
      <div className="options-stack">
        <section className="subtitle-empty" aria-label={t("subtitles.unavailable")}>
          <SubtitleIcon />
          <strong>{t("subtitles.emptyTitle")}</strong>
          <span>{t("subtitles.emptyText")}</span>
        </section>
      </div>
    );
  }

  return (
    <div className="options-stack">
      <section className="advanced-settings subtitle-advanced-settings" aria-label={t("subtitles.settings")}>
        <div className="settings-title subtitle-title">
          <SubtitleIcon />
          <h3>{t("subtitles.settings")}</h3>
        </div>
        <div className="settings-grid subtitle-settings-grid">
          <label>
            <span>{t("subtitles.language")}</span>
            <ParameterSelect
              label={t("subtitles.languageLabel")}
              value={selectedKey ?? ""}
              options={subtitles.map((subtitle) => ({
                value: subtitleKey(subtitle),
                label: subtitleLabel(subtitle, t),
              }))}
              onChange={(value) => {
                const next = subtitles.find((subtitle) => subtitleKey(subtitle) === value);
                if (next) onSubtitleChange(next);
              }}
            />
          </label>
          <label>
            <span>{t("subtitles.format")}</span>
            <ParameterSelect
              label={t("subtitles.formatLabel")}
              value={selectedFormat ?? ""}
              options={(selected?.formats ?? []).map((format) => ({
                value: format,
                label: format.toUpperCase(),
              }))}
              onChange={onFormatChange}
            />
          </label>
        </div>
      </section>
    </div>
  );
}

export function subtitleKey(subtitle: SubtitleOption) {
  return `${subtitle.automatic ? "auto" : "manual"}:${subtitle.language}`;
}

export function preferredSubtitleFormat(formats: string[]) {
  return formats.find((format) => format.toLowerCase() === "srt")
    ?? formats.find((format) => format.toLowerCase() === "vtt")
    ?? formats[0]
    ?? null;
}

function subtitleLabel(subtitle: SubtitleOption, t: Translate) {
  const language = subtitle.name === subtitle.language
    ? subtitle.language
    : `${subtitle.name} (${subtitle.language})`;
  return subtitle.automatic ? `${language} — ${t("subtitles.automatic")}` : language;
}

function SubtitleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5v-11A2.5 2.5 0 0 1 4.5 4ZM5 9v2h6V9H5Zm8 0v2h6V9h-6Zm-8 4v2h4v-2H5Zm6 0v2h8v-2h-8Z" />
    </svg>
  );
}
