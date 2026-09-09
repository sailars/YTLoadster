import { FormEvent, useEffect, useRef, useState } from "react";
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
  DownloadRequest,
  Job,
  MediaInfo,
  SubtitleOption,
  SubtitleSelection,
} from "../lib/types";
import { makeCookieSource } from "../lib/playlistModel";
import { AudioDownloadOptions } from "./downloader/AudioDownloadOptions";
import { DownloadModeTabs } from "./downloader/DownloadModeTabs";
import { MediaPreview } from "./downloader/MediaPreview";
import {
  preferredSubtitleFormat,
  SubtitleDownloadOptions,
  subtitleKey,
} from "./downloader/SubtitleDownloadOptions";
import { VideoDownloadOptions } from "./downloader/VideoDownloadOptions";
import { bestFormatId, formatCodec, formatExt, formatFps, formatHeight, predictFinalVideoContainer, selectClosestFormat } from "./downloader/videoFormats";
import { DownloadSummaryCard, type SummaryFact } from "./downloader/DownloadSummaryCard";
import { loadSavedVideoProfile, resolveVideoProfile, saveVideoProfile, type ResolvedVideoProfile } from "./downloader/videoProfiles";
import type { VideoDownloadProfile } from "../lib/types";

type Props = {
  authSettings: BrowserAuthSettings;
  includeVideoTechnicalDetailsInFilename: boolean;
  url: string;
  sourceIsVideo: boolean;
  repeatDraft?: { id: string; request?: DownloadRequest | null } | null;
  onUrlChange: (url: string) => void;
  onOpenQueue: () => void;
  onRepeatConsumed: () => void;
  onJobCreated: (job: Job) => void;
};

const audioPresets: DownloadPreset[] = ["audioMp3", "audioM4a", "audioOpus"];
type DownloadMode = "video" | "audio" | "subtitles";
type DuplicateKind = DownloadMode;
type DuplicateErrorState = { kind: DuplicateKind; signature: string };

export function Downloader({
  authSettings,
  includeVideoTechnicalDetailsInFilename,
  url,
  sourceIsVideo,
  repeatDraft,
  onUrlChange,
  onOpenQueue,
  onRepeatConsumed,
  onJobCreated,
}: Props) {
  const { locale, t } = useI18n();
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
  const [pendingHistoryDuplicate, setPendingHistoryDuplicate] = useState<DownloadRequest | null>(null);
  const [enqueueResult, setEnqueueResult] = useState<DownloadMode | null>(null);
  const restoredRepeat = useRef<string | null>(null);
  const currentDuplicateSignature = mediaDuplicateSignature({
    mode,
    canonicalSource: media?.webpageUrl ?? analyzedUrl ?? url,
    preset,
    videoFormatId: selectedVideoFormatId,
    audioFormatId: selectedAudioFormatId,
    selectedVideoAudioFormatId: selectedAudioFormatId,
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

    if (!currentUrl || !sourceIsVideo) {
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
  }, [url, sourceIsVideo, authSettings.useBrowserCookies, authSettings.useYoutubeSession, authSettings.browser, locale, t]);

  useEffect(() => {
    const request = repeatDraft?.request;
    if (!repeatDraft || !request) return;
    setDestinationDir(request.destinationDir);
    setAudioBitrate(request.audioBitrate ?? "320K");
    setAudioChannels(request.audioChannels ?? "source");
    setEmbedMetadata(request.embedMetadata ?? false);
    setEmbedThumbnail(request.embedThumbnail ?? false);
    if (request.preset === "subtitles") changeMode("subtitles");
    else if (audioPresets.includes(request.preset)) {
      changeMode("audio");
      setPreset(request.preset);
    } else {
      changeMode("video");
      setVideoProfile(request.videoProfile ?? "best");
      setPreset(request.preset);
    }
  }, [repeatDraft?.id]);

  useEffect(() => {
    const request = repeatDraft?.request;
    if (!repeatDraft || !request || !media || restoredRepeat.current === repeatDraft.id) return;
    restoredRepeat.current = repeatDraft.id;
    if (request.preset === "subtitles") {
      const requested = request.subtitle;
      const subtitle = media.subtitles?.find((item) =>
        item.language === requested?.language && item.automatic === requested?.automatic,
      ) ?? media.subtitles?.[0] ?? null;
      selectSubtitle(subtitle);
      if (subtitle && requested?.format && subtitle.formats.includes(requested.format)) {
        setSelectedSubtitleFormat(requested.format);
      }
      return;
    }
    if (audioPresets.includes(request.preset)) {
      setSelectedAudioFormatId(bestFormatId(media.audioFormats));
      return;
    }

    const requestedProfile = request.videoProfile ?? "best";
    if (requestedProfile === "custom" && request.videoTechnicalDetails) {
      const details = request.videoTechnicalDetails;
      setSelectedVideoFormatId(selectClosestFormat(media.videoFormats, null, {
        height: details.height ? String(details.height) : "all",
        fps: details.fps ? `${details.fps}fps` : "all",
        ext: details.requestedContainer ?? "all",
        codec: details.codec ?? "all",
      }));
      setSelectedAudioFormatId(bestFormatId(media.audioFormats));
    } else {
      const resolved = resolveVideoProfile(requestedProfile, media.videoFormats, media.audioFormats);
      const fallback = resolved.available ? resolved : resolveVideoProfile("best", media.videoFormats, media.audioFormats);
      setVideoProfile(resolved.available ? requestedProfile : "best");
      setSelectedVideoFormatId(fallback.videoFormatId);
      setSelectedAudioFormatId(fallback.audioFormatId);
    }
  }, [media, repeatDraft?.id]);

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

    setError(null);
    setDuplicateError(null);
    setEnqueueResult(null);
    const submittedDuplicateSignature = currentDuplicateSignature;
    const request = buildRequest();
    if (!request) return;
    setIsEnqueueing(true);
    try {
      if (!repeatDraft) {
        const duplicates = await api.checkHistoryDuplicates([{ clientId: "single", request }]);
        if (duplicates.length) {
          setPendingHistoryDuplicate(request);
          return;
        }
      }
      await submitRequest(request, submittedDuplicateSignature);
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

  function buildRequest(): DownloadRequest | null {
    const formatId = selectedFormatId();
    if (!formatId) return null;
    return {
      url: url.trim(),
      canonicalSource: media?.webpageUrl ?? analyzedUrl ?? url.trim(),
      title: media?.title ?? null,
      thumbnail: media?.thumbnail ?? null,
      preset,
      formatId,
      audioFormatId: mode === "video" ? selectedAudioFormatId : null,
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
    };
  }

  async function submitRequest(request: DownloadRequest, submittedDuplicateSignature: string | null) {
    try {
      const job = await api.enqueueDownload(request);
      onJobCreated(job);
      setEnqueueResult(
        request.preset === "subtitles"
          ? "subtitles"
          : audioPresets.includes(request.preset)
            ? "audio"
            : "video",
      );
      if (repeatDraft) onRepeatConsumed();
    } catch (err) {
      const duplicateKind = duplicateErrorKind(err);
      if (duplicateKind && duplicateKind === mode && submittedDuplicateSignature) {
        setDuplicateError({ kind: duplicateKind, signature: submittedDuplicateSignature });
      } else {
        setError(readableError(err, authSettings.browser, locale, t));
      }
    }
  }

  async function confirmHistoryDuplicate() {
    const request = pendingHistoryDuplicate;
    if (!request) return;
    setPendingHistoryDuplicate(null);
    setIsEnqueueing(true);
    try {
      await submitRequest(request, currentDuplicateSignature);
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
    if (mode === "video" && preset === "bestVideo") {
      const video = media?.videoFormats.find((format) => format.formatId === selectedVideoFormatId);
      const audio = media?.audioFormats.find((format) => format.formatId === selectedAudioFormatId);
      if (!video) return null;
      const codecs = [formatCodec(video), audio ? formatCodec(audio) : ""].filter(Boolean).join(" + ");
      return [
        formatHeight(video) ? `${formatHeight(video)}p` : null,
        formatFps(video),
        predictFinalVideoContainer(video, audio)?.toUpperCase(),
        codecs || null,
      ].filter(Boolean).join(" ");
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
        onUrlChange(text.trim());
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
    onUrlChange("");
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
            onUrlChange={onUrlChange}
            onPaste={pasteUrlFromClipboard}
            onClear={clearUrl}
            onOpen={openAnalyzedUrl}
            onCopy={copyAnalyzedUrl}
          />

          <div className="options-column">
            <section className="mode-section" aria-label={t("downloader.mode")}>
              <DownloadModeTabs mode={mode} onChange={changeMode} />
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
        {enqueueResult ? (
          <div className="inline-notice success-notice single-enqueue-result" role="status">
            <strong>
              {enqueueResult === "audio"
                ? t("downloader.enqueuedAudio")
                : enqueueResult === "subtitles"
                  ? t("downloader.enqueuedSubtitles")
                  : t("downloader.enqueuedVideo")}
            </strong>
            <button type="button" className="secondary" onClick={onOpenQueue}>{t("playlist.openQueue")}</button>
          </div>
        ) : null}
      </form>
      {pendingHistoryDuplicate ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="compact-dialog" role="dialog" aria-modal="true" aria-labelledby="single-history-duplicate-title">
            <h3 id="single-history-duplicate-title">{t("downloader.historyDuplicateTitle")}</h3>
            <p>{t("downloader.historyDuplicateText")}</p>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setPendingHistoryDuplicate(null)}>{t("common.cancel")}</button>
              <button type="button" className="primary" onClick={() => void confirmHistoryDuplicate()}>{t("playlist.downloadAgain")}</button>
            </div>
          </section>
        </div>
      ) : null}
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
    { label: t("subtitles.format"), value: subtitleFormat?.toUpperCase() ?? "-" },
  ];
  if (mode === "audio") return [
    { label: t("common.format"), value: preset === "audioM4a" ? "M4A" : preset === "audioOpus" ? "OPUS" : "MP3" },
    { label: t("audio.bitrate"), value: bitrate },
    { label: t("audio.channels"), value: channels === "source" ? t("audio.sourceChannelsSummary") : channels },
  ];
  const video = media?.videoFormats.find((item) => item.formatId === videoId);
  const audio = media?.audioFormats.find((item) => item.formatId === audioId);
  const container = preset === "bestVideo"
    ? predictFinalVideoContainer(video, audio)
    : video ? formatExt(video) : null;
  const videoCodec = video ? formatCodec(video) : "";
  const audioCodec = preset === "bestVideo" && audio ? formatCodec(audio) : "";
  const codecs = [videoCodec, audioCodec].filter(Boolean).join(" + ");
  return [
    { label: t("common.format"), value: video ? `${(container ?? "-").toUpperCase()}${codecs ? ` (${codecs})` : ""}` : t("common.formatMissing") },
    { label: t("video.resolution"), value: video ? `${formatHeight(video) ?? "-"}p` : "-" },
    { label: t("video.fps"), value: video ? formatFps(video) ?? "-" : "-" },
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
