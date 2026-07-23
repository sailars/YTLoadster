import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { FormatOption, VideoDownloadProfile } from "../../lib/types";
import { ParameterSelect, type ParameterSelectOption } from "../ParameterSelect";
import { formatCodec, formatExt, formatHeight, isFilterValueAvailable, selectFormatForFilters, type VideoSelection, videoFilterOptions } from "./videoFormats";
import { resolveVideoProfile, type ResolvedVideoProfile } from "./videoProfiles";

type Props = {
  formats: FormatOption[];
  audioFormats: FormatOption[];
  profile: VideoDownloadProfile;
  onProfileChange: (profile: VideoDownloadProfile, result: ResolvedVideoProfile) => void;
  onManualFormatChange: (formatId: string | null) => void;
};

const profiles: VideoDownloadProfile[] = ["best", "mp4-1080", "mp4-720", "mp4-480", "mp4-360", "universal", "phone", "tablet", "smart-tv", "legacy"];

export function VideoDownloadOptions({ formats, audioFormats, profile, onProfileChange, onManualFormatChange }: Props) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<VideoSelection>({ height: "all", fps: "all", ext: "all", codec: "all" });
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const profileResults = useMemo(() => new Map(profiles.map((item) => [item, resolveVideoProfile(item, formats, audioFormats)])), [formats, audioFormats]);
  const options = videoFilterOptions(formats);
  const commonResolutions = commonResolutionOptions(t);

  useEffect(() => { setFilters({ height: "all", fps: "all", ext: "all", codec: "all" }); }, [formats]);

  const profileOptions: ParameterSelectOption[] = profiles.map((item) => {
    const result = profileResults.get(item)!;
    const group = item === "best" || item.startsWith("mp4-") ? t("video.qualityProfiles") : t("video.deviceProfiles");
    const label = item === "best" ? t("video.best") : t(`video.profile.${item}` as Parameters<typeof t>[0]);
    const description = item === "best" ? t("video.bestDescription") : profileDescription(item, t);
    const reason = result.unavailableReason ? t(`video.unavailable.${result.unavailableReason}` as Parameters<typeof t>[0]) : undefined;
    return { value: item, label, description, group, icon: item === "best" ? <SparklesIcon /> : item.startsWith("mp4-") ? <DisplayIcon /> : undefined, disabled: formats.length > 0 && !result.available && profile !== item, disabledReason: reason };
  });

  function chooseProfile(value: string) {
    const next = value as VideoDownloadProfile;
    onProfileChange(next, profileResults.get(next) ?? resolveVideoProfile(next, formats, audioFormats));
    if (next !== "custom") setFilters({ height: "all", fps: "all", ext: "all", codec: "all" });
  }

  function choose(criteria: Partial<VideoSelection>) {
    const next = { ...filters, ...criteria };
    const formatId = selectFormatForFilters(formats, next);
    if (!formatId) return;
    setFilters(next);
    onManualFormatChange(formatId);
  }

  const available = (key: keyof VideoSelection, value: string) => value === "all" || isFilterValueAvailable(formats, filters, key, value);
  return <div className="options-stack">
    <section className="video-profile-select" aria-label={t("video.profile")}>
      <label><span>{t("video.profile")}</span><ParameterSelect label={t("video.profile")} value={profile} options={profileOptions} selectedOption={profile === "custom" ? { value: "custom", label: t("video.custom"), description: t("video.customDescription") } : undefined} onChange={chooseProfile} /></label>
      {profile !== "custom" && formats.length > 0 && !profileResults.get(profile)?.available ? <p className="profile-unavailable">{t("video.profileUnavailable")}</p> : null}
    </section>
    <section className="advanced-settings video-advanced-settings" aria-label={t("video.advancedLabel")}>
      <button type="button" className="settings-title" aria-expanded={isAdvancedOpen} aria-controls="video-advanced-settings" onClick={() => setIsAdvancedOpen((open) => !open)}><AdjustmentsIcon /><h3>{t("video.advanced")}</h3><ChevronIcon expanded={isAdvancedOpen} /></button>
      {isAdvancedOpen ? <div id="video-advanced-settings" className="settings-grid video-settings-grid">
        <Field label={t("video.resolution")} value={filters.height} values={resolutionOptions(formats, options.heights, available, t("common.auto"), commonResolutions)} onChange={(height) => choose({ height })} />
        <Field label={t("video.fps")} value={filters.fps} values={[{ value: "all", label: t("common.auto") }, ...options.fps.map((value) => ({ value, label: value.replace("fps", ""), disabled: !available("fps", value) }))]} onChange={(fps) => choose({ fps })} />
        <Field label={t("video.container")} value={filters.ext} values={[{ value: "all", label: t("common.auto") }, ...options.exts.map((value) => ({ value, label: value.toUpperCase(), disabled: !available("ext", value) }))]} onChange={(ext) => choose({ ext })} />
        <Field label={t("video.codec")} value={filters.codec} values={[{ value: "all", label: t("common.auto") }, ...options.codecs.map((value) => ({ value, label: value, disabled: !available("codec", value) }))]} onChange={(codec) => choose({ codec })} />
      </div> : null}
    </section>
  </div>;
}

function Field({ label, value, values, onChange }: { label: string; value: string; values: ParameterSelectOption[]; onChange: (value: string) => void }) { return <label><span>{label}</span><ParameterSelect label={label} value={value} options={values} onChange={onChange} /></label>; }
function commonResolutionOptions(t: ReturnType<typeof useI18n>["t"]): ParameterSelectOption[] {
  return [
    { value: "4320", label: t("video.resolution.4320") },
    { value: "2160", label: t("video.resolution.2160") },
    { value: "1440", label: t("video.resolution.1440") },
    { value: "1080", label: t("video.resolution.1080") },
    { value: "720", label: t("video.resolution.720") },
    { value: "480", label: t("video.resolution.480") },
  ];
}
function resolutionOptions(formats: FormatOption[], availableHeights: string[], isAvailable: (key: keyof VideoSelection, value: string) => boolean, autoLabel: string, commonOptions: ParameterSelectOption[]): ParameterSelectOption[] {
  const commonValues = new Set(commonOptions.map((option) => option.value));
  const sourceOnlyOptions = availableHeights
    .filter((value) => !commonValues.has(value))
    .map((value) => ({ value, label: resolutionLabel(formats, value) }));
  return [
    { value: "all", label: autoLabel },
    ...commonOptions.map((option) => ({ ...option, disabled: !isAvailable("height", option.value) })),
    ...sourceOnlyOptions.map((option) => ({ ...option, disabled: !isAvailable("height", option.value) })),
  ];
}
function profileDescription(profile: VideoDownloadProfile, t: ReturnType<typeof useI18n>["t"]) {
  switch (profile) {
    case "mp4-1080": return t("video.fullHdDescription");
    case "mp4-720": return t("video.hdDescription");
    case "mp4-480": return t("video.compactDescription");
    case "mp4-360": return t("video.smallDescription");
    default: return t(`video.profileDescription.${profile}` as Parameters<typeof t>[0]);
  }
}
function resolutionLabel(formats: FormatOption[], height: string) {
  const format = formats.find((candidate) => String(formatHeight(candidate) ?? "") === height);
  const resolvedHeight = format ? formatHeight(format) : Number(height);
  const dimensions = format?.width && resolvedHeight ? `${format.width}×${resolvedHeight}` : `${height}p`;
  return `${dimensions} (${resolutionName(resolvedHeight ?? Number(height))})`;
}
function resolutionName(height: number) {
  switch (height) {
    case 4320: return "8K UHD";
    case 2160: return "4K UHD";
    case 1440: return "2K QHD";
    case 1080: return "Full HD";
    case 720: return "HD";
    default: return `${height}p`;
  }
}
function SparklesIcon() { return <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5c.55 3.55 2.35 5.35 5.9 5.9-3.55.55-5.35 2.35-5.9 5.9-.55-3.55-2.35-5.35-5.9-5.9 3.55-.55 5.35-2.35 5.9-5.9Z" /><path d="M18.25 15.5c.25 1.65 1.1 2.5 2.75 2.75-1.65.25-2.5 1.1-2.75 2.75-.25-1.65-1.1-2.5-2.75-2.75 1.65-.25 2.5-1.1 2.75-2.75Z" /></svg>; }
function DisplayIcon() { return <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="13" rx="2.25" /><path d="M9 20h6" /><path d="M12 17.5V20" /></svg>; }
function AdjustmentsIcon() { return <svg className="outline-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h5" /><path d="M15 7h5" /><circle cx="12" cy="7" r="2.25" /><path d="M4 17h9" /><path d="M19 17h1" /><circle cx="16" cy="17" r="2.25" /></svg>; }
function ChevronIcon({ expanded }: { expanded: boolean }) { return <svg className={expanded ? "chevron-icon expanded" : "chevron-icon"} aria-hidden="true" viewBox="0 0 20 20" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m6.5 8 3.5 3.5L13.5 8" /></svg>; }
