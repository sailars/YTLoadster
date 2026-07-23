import { FormEvent, useEffect, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api } from "../lib/api";
import {
  isYouTubeAgeRestrictionError,
  isYouTubeBotConfirmationError,
  isYouTubeRateLimitError,
  sanitizeTechnicalError,
} from "../lib/errors";
import { localizeTechnicalText, useI18n, type AppLocale, type Translate } from "../lib/i18n";
import type {
  BrowserAuthSettings,
  CookieSource,
  DownloadPreset,
  Job,
  MediaInfo,
  SubtitleOption,
  SubtitleSelection,
} from "../lib/types";
import { AudioDownloadOptions } from "./downloader/AudioDownloadOptions";
import { AudioWaveIcon } from "./downloader/AudioWaveIcon";
import { MediaPreview } from "./downloader/MediaPreview";
import {
  preferredSubtitleFormat,
  SubtitleDownloadOptions,
  subtitleKey,
} from "./downloader/SubtitleDownloadOptions";
import { VideoDownloadOptions } from "./downloader/VideoDownloadOptions";
import { bestFormatId, formatCodec, formatExt, formatFps, formatHeight } from "./downloader/videoFormats";
import { DownloadSummaryCard, type SummaryFact } from "./downloader/DownloadSummaryCard";
import { loadSavedVideoProfile, resolveVideoProfile, saveVideoProfile, type ResolvedVideoProfile } from "./downloader/videoProfiles";
import type { VideoDownloadProfile } from "../lib/types";

type Props = {
  authSettings: BrowserAuthSettings;
  includeVideoTechnicalDetailsInFilename: boolean;
  onJobCreated: (job: Job) => void;
};

const audioPresets: DownloadPreset[] = ["audioMp3", "audioM4a", "audioOpus"];
type DownloadMode = "video" | "audio" | "subtitles";
type DuplicateKind = DownloadMode;
type DuplicateErrorState = { kind: DuplicateKind; signature: string };

export function Downloader({ authSettings, includeVideoTechnicalDetailsInFilename, onJobCreated }: Props) {
  const { locale, t } = useI18n();
  const [url, setUrl] = useState("");
  const [destinationDir, setDestinationDir] = useState("");
  const [mode, setMode] = useState<DownloadMode>("video");
  const [preset, setPreset] = useState<DownloadPreset>("bestVideo");
  const [videoProfile, setVideoProfile] = useState<VideoDownloadProfile>(() => loadSavedVideoProfile());
  const [selectedVideoFormatId, setSelectedVideoFormatId] = useState<string | null>(null);
  const [selectedAudioFormatId, setSelectedAudioFormatId] = useState<string | null>(null);
  const [selectedSubtitleKey, setSelectedSubtitleKey] = useState<string | null>(null);
  const [selectedSubtitleFormat, setSelectedSubtitleFormat] = useState<string | null>(null);
  const [audioBitrate, setAudioBitrate] = useState("320K");
  const [audioChannels, setAudioChannels] = useState("stereo");
  const [embedMetadata, setEmbedMetadata] = useState(false);
  const [embedThumbnail, setEmbedThumbnail] = useState(false);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<DuplicateErrorState | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isEnqueueing, setIsEnqueueing] = useState(false);
  const currentDuplicateSignature = mediaDuplicateSignature({
    mode,
    canonicalSource: media?.webpageUrl ?? analyzedUrl ?? url,
    preset,
    videoFormatId: selectedVideoFormatId,
    audioFormatId: selectedAudioFormatId,
    selectedVideoAudioFormatId: videoProfile === "best" ? null : selectedAudioFormatId,
    requestedContainer: selectedVideoTechnicalDetails()?.requestedContainer ?? (preset === "mp4Video" ? "mp4" : null),
    audioBitrate,
    audioChannels,
    embedMetadata,
    embedThumbnail,
    subtitle: selectedSubtitleRequest(),
  });

  useEffect(() => {
    api.getDefaultDownloadDir().then(setDestinationDir).catch(() => setDestinationDir("Downloads"));
  }, []);

  useEffect(() => {
    const currentUrl = url.trim();
    setMedia(null);
    setAnalyzedUrl(null);
    setSelectedVideoFormatId(null);
    setSelectedAudioFormatId(null);
    setSelectedSubtitleKey(null);
    setSelectedSubtitleFormat(null);

    if (!currentUrl) {
      setError(null);
      setIsAnalyzing(false);
      return;
    }

    let isCurrent = true;
    setIsAnalyzing(true);
    setError(null);
    const timeout = window.setTimeout(async () => {
      if (!isYouTubeUrl(currentUrl)) {
        if (isCurrent) {
          setError(t("error.invalidUrl"));
          setIsAnalyzing(false);
        }
        return;
      }

      try {
        await waitForPaint();
        const result = await api.probeUrl(
          currentUrl,
          makeCookieSource(authSettings),
        );
        if (!isCurrent) return;
        const bestAudioFormatId = bestFormatId(result.audioFormats);
        setMedia(result);
        setAnalyzedUrl(currentUrl);
        const restoredProfile = loadSavedVideoProfile();
        const restoredResolution = resolveVideoProfile(restoredProfile, result.videoFormats, result.audioFormats);
        const profile = isQualityProfile(restoredProfile) && !restoredResolution.available ? "best" : restoredProfile;
        const resolved = profile === restoredProfile
          ? restoredResolution
          : resolveVideoProfile(profile, result.videoFormats, result.audioFormats);
        setVideoProfile(profile);
        if (profile !== restoredProfile) {
          setPreset((current) => (audioPresets.includes(current) || current === "subtitles" ? current : "bestVideo"));
        }
        setSelectedVideoFormatId(resolved.videoFormatId);
        setSelectedAudioFormatId(profile === "best" ? bestAudioFormatId : resolved.audioFormatId);
        setAudioChannels(result.audioFormats.find((format) => format.formatId === bestAudioFormatId)?.audioChannels === 1 ? "source" : "stereo");
        selectSubtitle(result.subtitles?.[0] ?? null);
      } catch (err) {
        if (isCurrent) setError(readableError(err, authSettings.browser, locale, t));
      } finally {
        if (isCurrent) setIsAnalyzing(false);
      }
    }, 350);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeout);
    };
  }, [url, authSettings.useBrowserCookies, authSettings.useYoutubeSession, authSettings.browser, locale, t]);

  useEffect(() => {
    setDuplicateError((current) =>
      current && (current.kind !== mode || current.signature !== currentDuplicateSignature)
        ? null
        : current,
    );
  }, [currentDuplicateSignature, mode]);

  async function enqueue(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) {
      setError(t("error.urlFirst"));
      return;
    }
    if (!destinationDir.trim()) {
      setError(t("error.destination"));
      return;
    }
    if (!canDownload()) {
      setError(t("error.waitAnalysis"));
      return;
    }

    setIsEnqueueing(true);
    setError(null);
    setDuplicateError(null);
    const submittedDuplicateSignature = currentDuplicateSignature;
    try {
      const job = await api.enqueueDownload({
        url: url.trim(),
        canonicalSource: media?.webpageUrl ?? analyzedUrl ?? url.trim(),
        title: media?.title ?? null,
        thumbnail: media?.thumbnail ?? null,
        preset,
        formatId: selectedFormatId(),
        audioFormatId: mode === "video" && videoProfile !== "best" ? selectedAudioFormatId : null,
        videoProfile: mode === "video" ? videoProfile : null,
        formatLabel: selectedFormatLabel(),
        includeVideoTechnicalDetailsInFilename: mode === "video" && includeVideoTechnicalDetailsInFilename,
        videoTechnicalDetails: mode === "video" ? selectedVideoTechnicalDetails() : null,
        destinationDir,
        cookieSource: makeCookieSource(authSettings),
        audioBitrate: mode === "audio" ? audioBitrate : null,
        audioChannels: mode === "audio" ? audioChannels : null,
        embedMetadata: mode === "audio" ? embedMetadata : null,
        embedThumbnail: mode === "audio" ? embedThumbnail : null,
        subtitle: mode === "subtitles" ? selectedSubtitleRequest() : null,
      });
      onJobCreated(job);
    } catch (err) {
      const duplicateKind = duplicateErrorKind(err);
      if (duplicateKind && duplicateKind === mode && submittedDuplicateSignature) {
        setDuplicateError({ kind: duplicateKind, signature: submittedDuplicateSignature });
      } else {
        setError(readableError(err, authSettings.browser, locale, t));
      }
    } finally {
      setIsEnqueueing(false);
    }
  }

  function changeMode(nextMode: DownloadMode) {
    setMode(nextMode);
    if (nextMode === "audio") {
      setPreset((current) => (audioPresets.includes(current) ? current : "audioMp3"));
    } else if (nextMode === "subtitles") {
      setPreset("subtitles");
    } else {
      setPreset((current) => (audioPresets.includes(current) || current === "subtitles" ? "bestVideo" : current));
    }
  }

  function selectSubtitle(subtitle: SubtitleOption | null) {
    setSelectedSubtitleKey(subtitle ? subtitleKey(subtitle) : null);
    setSelectedSubtitleFormat(subtitle ? preferredSubtitleFormat(subtitle.formats) : null);
  }

  function selectedSubtitle() {
    return media?.subtitles?.find((subtitle) => subtitleKey(subtitle) === selectedSubtitleKey) ?? null;
  }

  function selectedSubtitleRequest() {
    const subtitle = selectedSubtitle();
    if (!subtitle || !selectedSubtitleFormat) return null;
    return {
      language: subtitle.language,
      format: selectedSubtitleFormat,
      automatic: subtitle.automatic,
    };
  }

  function changeVideoProfile(nextProfile: VideoDownloadProfile, resolved: ResolvedVideoProfile) {
    setVideoProfile(nextProfile);
    if (nextProfile !== "custom") saveVideoProfile(nextProfile);
    setPreset(nextProfile === "best" ? "bestVideo" : "mp4Video");
    setSelectedVideoFormatId(resolved.videoFormatId);
    setSelectedAudioFormatId(resolved.audioFormatId);
  }

  function changeManualVideoFormat(formatId: string | null) {
    setVideoProfile("custom");
    setPreset("mp4Video");
    setSelectedVideoFormatId(formatId);
  }

  async function chooseDestinationDir() {
    setError(null);
    try {
      const selected = await api.selectDownloadDir(destinationDir);
      if (selected) setDestinationDir(selected);
    } catch (err) {
      setError(t("error.openFolder", { error: readableError(err, undefined, locale, t) }));
    }
  }

  function selectedFormatId() {
    if (mode === "subtitles") return selectedSubtitle()?.language ?? null;
    return mode === "audio" ? selectedAudioFormatId : selectedVideoFormatId;
  }

  function selectedFormatLabel() {
    if (mode === "subtitles") {
      const subtitle = selectedSubtitle();
      if (!subtitle || !selectedSubtitleFormat) return null;
      return `${subtitle.name} (${subtitle.language}) • ${selectedSubtitleFormat.toUpperCase()}${subtitle.automatic ? ` • ${t("subtitles.automatic")}` : ""}`;
    }
    const formats = mode === "audio" ? media?.audioFormats : media?.videoFormats;
    const label = formats?.find((format) => format.formatId === selectedFormatId())?.qualityLabel;
    return label ? localizeTechnicalText(label, locale) : null;
  }

  function selectedVideoTechnicalDetails() {
    const format = media?.videoFormats.find((candidate) => candidate.formatId === selectedVideoFormatId);
    if (!format) return null;
    return {
      height: formatHeight(format),
      fps: format.fps ?? null,
      codec: formatCodec(format) || null,
      dynamicRange: format.dynamicRange ?? null,
      requestedContainer: formatExt(format),
    };
  }

  async function pasteUrlFromClipboard() {
    setError(null);
    try {
      const text = await readText();
      if (text?.trim()) {
        setUrl(text.trim());
      } else {
        setError(t("error.clipboardTextUnavailable"));
      }
    } catch (err) {
      setError(
        isClipboardTextUnavailableError(err)
          ? t("error.clipboardTextUnavailable")
          : t("error.paste", { error: readableError(err, undefined, locale, t) }),
      );
    }
  }

  async function copyAnalyzedUrl() {
    const targetUrl = media?.webpageUrl ?? analyzedUrl ?? url.trim();
    if (targetUrl) await writeText(targetUrl);
  }

  async function openAnalyzedUrl() {
    const targetUrl = media?.webpageUrl ?? analyzedUrl ?? url.trim();
    if (!targetUrl) return;

    try {
      await api.openExternalUrl(targetUrl);
    } catch (err) {
      setError(t("error.openBrowser", { error: readableError(err, undefined, locale, t) }));
    }
  }

  function resetAnalyzedUrl() {
    setUrl("");
    setMedia(null);
    setAnalyzedUrl(null);
    setSelectedVideoFormatId(null);
    setSelectedAudioFormatId(null);
    setSelectedSubtitleKey(null);
    setSelectedSubtitleFormat(null);
  }

  function clearUrl() {
    resetAnalyzedUrl();
    setError(null);
    setDuplicateError(null);
    setIsAnalyzing(false);
  }

  function canDownload() {
    return Boolean(
      url.trim() &&
        media &&
        analyzedUrl === url.trim() &&
        selectedFormatId() &&
        (mode !== "subtitles" || selectedSubtitleRequest()) &&
        destinationDir.trim() &&
        !isAnalyzing &&
        (mode !== "video" || videoProfile === "custom" || resolveVideoProfile(videoProfile, media.videoFormats, media.audioFormats).available),
    );
  }

  return (
    <section className="download-panel" aria-label={t("downloader.label")}>
      <form onSubmit={enqueue}>
        <div className="download-workspace">
          <MediaPreview
            url={url}
            media={media}
            error={error}
            isAnalyzing={isAnalyzing}
            onUrlChange={setUrl}
            onPaste={pasteUrlFromClipboard}
            onClear={clearUrl}
            onOpen={openAnalyzedUrl}
            onCopy={copyAnalyzedUrl}
          />

          <div className="options-column">
            <section className="mode-section" aria-label={t("downloader.mode")}>
              <div className="mode-tabs" role="tablist" aria-label={t("downloader.mode")}>
                <button type="button" role="tab" aria-label={t("downloader.video")} className="mode-tab" aria-selected={mode === "video"} onClick={() => changeMode("video")}>
                  <span className="mode-tab-icon"><VideoIcon /></span>
                  <strong>{t("downloader.video")}</strong>
                </button>
                <button type="button" role="tab" aria-label={t("downloader.audio")} className="mode-tab" aria-selected={mode === "audio"} onClick={() => changeMode("audio")}>
                  <span className="mode-tab-icon"><AudioWaveIcon /></span>
                  <strong>{t("downloader.audio")}</strong>
                </button>
                <button type="button" role="tab" aria-label={t("downloader.subtitles")} className="mode-tab" aria-selected={mode === "subtitles"} onClick={() => changeMode("subtitles")}>
                  <span className="mode-tab-icon"><SubtitleModeIcon /></span>
                  <strong>{t("downloader.subtitles")}</strong>
                </button>
              </div>
            </section>

            {mode === "video" ? (
              <VideoDownloadOptions
                formats={media?.videoFormats ?? []}
                audioFormats={media?.audioFormats ?? []}
                profile={videoProfile}
                onProfileChange={changeVideoProfile}
                onManualFormatChange={changeManualVideoFormat}
              />
            ) : mode === "audio" ? (
              <AudioDownloadOptions
                preset={preset}
                bitrate={audioBitrate}
                channels={audioChannels}
                embedMetadata={embedMetadata}
                embedThumbnail={embedThumbnail}
                selectedFormat={media?.audioFormats.find((format) => format.formatId === selectedAudioFormatId)}
                onPresetChange={setPreset}
                onBitrateChange={setAudioBitrate}
                onChannelsChange={setAudioChannels}
                onEmbedMetadataChange={setEmbedMetadata}
                onEmbedThumbnailChange={setEmbedThumbnail}
              />
            ) : (
              <SubtitleDownloadOptions
                subtitles={media?.subtitles ?? []}
                selectedKey={selectedSubtitleKey}
                selectedFormat={selectedSubtitleFormat}
                onSubtitleChange={selectSubtitle}
                onFormatChange={setSelectedSubtitleFormat}
              />
            )}
            <DownloadSummaryCard
              tags={summaryTags(mode, media, selectedVideoFormatId, t)}
              facts={summaryFacts(mode, media, selectedVideoFormatId, selectedAudioFormatId, selectedSubtitle(), selectedSubtitleFormat, preset, audioBitrate, audioChannels, t)}
              destinationDir={destinationDir}
              onDestinationChange={setDestinationDir}
              onBrowse={chooseDestinationDir}
              buttonAriaLabel={mode === "audio" ? t("downloader.downloadAudio") : mode === "subtitles" ? t("downloader.downloadSubtitles") : t("downloader.downloadVideo")}
              busy={isEnqueueing}
              analyzed={Boolean(media) && !isAnalyzing}
              disabled={isEnqueueing || !canDownload()}
              error={duplicateError ? t(duplicateErrorTranslationKey(duplicateError.kind)) : null}
            />
          </div>
        </div>
      </form>
    </section>
  );
}

function mediaDuplicateSignature(options: {
  mode: DownloadMode;
  canonicalSource: string;
  preset: DownloadPreset;
  videoFormatId: string | null;
  audioFormatId: string | null;
  selectedVideoAudioFormatId: string | null;
  requestedContainer: string | null;
  audioBitrate: string;
  audioChannels: string;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  subtitle: SubtitleSelection | null;
}) {
  const source = options.canonicalSource.trim();
  if (options.mode === "video") {
    return JSON.stringify([
      source,
      options.videoFormatId?.trim() || null,
      options.selectedVideoAudioFormatId?.trim() || null,
      options.requestedContainer?.trim().toLowerCase() || null,
    ]);
  }
  if (options.mode === "audio") {
    return JSON.stringify([
      source,
      options.audioFormatId?.trim() || null,
      options.preset,
      options.audioBitrate.trim().toLowerCase() || null,
      ["mono", "stereo"].includes(options.audioChannels) ? options.audioChannels : "source",
      options.embedMetadata,
      options.embedThumbnail,
    ]);
  }
  const subtitle = options.subtitle;
  return subtitle
    ? JSON.stringify([
        source,
        subtitle.language.trim().toLowerCase(),
        subtitle.format.trim().toLowerCase(),
        subtitle.automatic,
      ])
    : null;
}

function duplicateErrorKind(error: unknown): DuplicateKind | null {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("enqueue-error:duplicate-video")) return "video";
  if (normalized.includes("enqueue-error:duplicate-audio")) return "audio";
  if (normalized.includes("enqueue-error:duplicate-subtitles")) return "subtitles";
  return null;
}

function duplicateErrorTranslationKey(kind: DuplicateKind) {
  if (kind === "audio") return "error.duplicateAudio" as const;
  if (kind === "subtitles") return "error.duplicateSubtitles" as const;
  return "error.duplicateVideo" as const;
}

function VideoIcon() {
  return (
    <svg className="mode-icon-outline" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.75" y="5" width="18.5" height="14" rx="2.5" />
      <path className="mode-icon-solid" d="m10 9 5 3-5 3V9Z" />
    </svg>
  );
}

function SubtitleModeIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5v-11A2.5 2.5 0 0 1 4.5 4ZM5 9v2h6V9H5Zm8 0v2h6V9h-6Zm-8 4v2h4v-2H5Zm6 0v2h8v-2h-8Z" /></svg>;
}

function summaryTags(mode: DownloadMode, media: MediaInfo | null, videoId: string | null, t: Translate) {
  if (mode !== "video") return [];
  const format = media?.videoFormats.find((item) => item.formatId === videoId);
  if (!format) return [];
  const height = formatHeight(format);
  const quality = height === 4320 ? t("video.qualityTag.8k")
    : height === 2160 ? t("video.qualityTag.4k")
      : height === 1440 ? t("video.qualityTag.2k")
        : height === 1080 ? t("video.qualityTag.fullHd")
          : null;
  return [quality, format.dynamicRange].filter((tag): tag is string => Boolean(tag));
}

function summaryFacts(
  mode: DownloadMode,
  media: MediaInfo | null,
  videoId: string | null,
  audioId: string | null,
  subtitle: SubtitleOption | null,
  subtitleFormat: string | null,
  preset: DownloadPreset,
  bitrate: string,
  channels: string,
  t: Translate,
): SummaryFact[] {
  if (mode === "subtitles") return [
    { label: t("subtitles.language"), value: subtitle ? subtitle.name : t("subtitles.notSelected") },
    { label: t("subtitles.format"), value: subtitleFormat?.toUpperCase() ?? "—" },
  ];
  if (mode === "audio") return [
    { label: t("common.format"), value: preset === "audioM4a" ? "M4A" : preset === "audioOpus" ? "OPUS" : "MP3" },
    { label: t("audio.bitrate"), value: bitrate },
    { label: t("audio.channels"), value: channels === "source" ? t("audio.sourceChannelsSummary") : channels },
  ];
  const video = media?.videoFormats.find((item) => item.formatId === videoId);
  const audio = media?.audioFormats.find((item) => item.formatId === audioId);
  return [
    { label: t("common.format"), value: video ? `${(formatExt(video) ?? "—").toUpperCase()}${formatCodec(video) ? ` (${formatCodec(video)})` : ""}` : t("common.formatMissing") },
    { label: t("video.resolution"), value: video ? `${formatHeight(video) ?? "—"}p` : "—" },
    { label: t("video.fps"), value: video ? formatFps(video) ?? "—" : "—" },
    { label: t("common.size"), value: knownSize(video?.filesize, audio?.filesize, t) },
  ];
}

function knownSize(videoSize: number | null | undefined, audioSize: number | null | undefined, t: Translate) {
  if (videoSize == null || audioSize == null) return t("common.unknown");
  const bytes = videoSize + audioSize;
  const unit = bytes >= 1024 ** 3 ? "GB" : "MB";
  const value = bytes / (unit === "GB" ? 1024 ** 3 : 1024 ** 2);
  return `≈ ${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });
}

function makeCookieSource(settings: BrowserAuthSettings): CookieSource | null {
  if (settings.useYoutubeSession) {
    return { kind: "youtubeSession" };
  }
  return settings.useBrowserCookies
    ? { kind: "browser", value: { browser: settings.browser, profile: null } }
    : null;
}

function isQualityProfile(profile: VideoDownloadProfile) {
  return profile === "mp4-1080" || profile === "mp4-720" || profile === "mp4-480" || profile === "mp4-360";
}

function isYouTubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function isClipboardTextUnavailableError(error: unknown) {
  const normalized = String(error).toLowerCase();
  return normalized.includes("clipboard contents were not available")
    || normalized.includes("clipboard is empty")
    || (normalized.includes("clipboard") && normalized.includes("requested format"));
}

function readableError(error: unknown, browser: string | undefined, locale: AppLocale, t: Translate) {
  const message = String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("enqueue-error:duplicate-video")) {
    return t("error.duplicateVideo");
  }
  if (normalized.includes("enqueue-error:duplicate-audio")) {
    return t("error.duplicateAudio");
  }
  if (normalized.includes("enqueue-error:duplicate-subtitles")) {
    return t("error.duplicateSubtitles");
  }
  if (normalized.includes("download-error:missing-ffmpeg")) {
    return t("error.missingFfmpeg");
  }
  if (isYouTubeAgeRestrictionError(message)) {
    return t("error.ageRestricted");
  }
  if (isYouTubeBotConfirmationError(message)) {
    return t("error.botConfirmation");
  }
  if (isYouTubeRateLimitError(message)) {
    return t("error.rateLimited");
  }
  if (normalized.includes("could not copy chrome cookie database")) {
    const baseMessage = t("error.cookiesLocked");
    return browser === "firefox" || browser === "librewolf"
      ? baseMessage
      : `${baseMessage} ${t("error.cookiesOtherBrowser")}`;
  }
  if (normalized.includes("failed to decrypt with dpapi") || (normalized.includes("dpapi") && normalized.includes("failed to decrypt"))) {
    return t("error.cookiesDpapi");
  }
  if (normalized.includes("could not find") && normalized.includes("cookies") && normalized.includes("cookies database")) {
    const browserName = normalized.includes("firefox") ? "Firefox" : normalized.includes("edge") ? "Edge" : normalized.includes("chrome") ? "Chrome" : t("error.selectedBrowser");
    return t("error.cookiesNotFound", { browser: browserName });
  }
  if (locale === "en" && /[А-Яа-яЁё]/.test(message)) return t("error.unknown");
  return sanitizeTechnicalError(message, locale === "ru" ? "программа" : "application");
}
