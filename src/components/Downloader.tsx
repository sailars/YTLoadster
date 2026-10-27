import { FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api } from "../lib/api";
import { NoticeCountdown, noticeDurationMs } from "./NoticeCountdown";
import { localizedYoutubeAuthError } from "../lib/youtubeAuth";
import {
  isYouTubeAgeRestrictionError,
  isYouTubeBotConfirmationError,
  isYouTubeRateLimitError,
  isYouTubeForbiddenError,
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
import { MusicDownloadSummary } from "./music/MusicDownloadSummary";
import { MusicAudioOptions, MusicMetadataEditor, MusicModeTabs, MusicParametersGroup } from "./music/MusicControls";
import { musicMetadata, musicAudioLabel, musicAudioBytes, musicConversionAvailable, selectMusicAudio, withMusicContext, type MusicAudioPreset, type MusicEdits } from "../lib/musicModel";
import { DownloadModeTabs } from "./downloader/DownloadModeTabs";
import { MediaPreview } from "./downloader/MediaPreview";
import { UrlInput } from "./downloader/UrlInput";
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
import type { SingleWorkspace, WorkspaceKey, WorkspaceView } from "../lib/workspace";

type Props = {
  initialWorkspace?: SingleWorkspace;
  workspacePersistenceEnabled?: boolean;
  workspaceKey?: WorkspaceKey;
  onWorkspaceChange?: (key: WorkspaceKey, view: WorkspaceView) => void;
  settingsResetVersion?: number;
  musicMode?: boolean;
  audioEncoders?: string[] | null;
  sourceHeaderAction?: ReactNode;
  authSettings: BrowserAuthSettings;
  defaultDestinationDir?: string | null;
  includeVideoTechnicalDetailsInFilename: boolean;
  url: string;
  sourceIsVideo: boolean;
  repeatDraft?: { id: string; request?: DownloadRequest | null } | null;
  onUrlChange: (url: string) => void;
  onOpenQueue: () => void;
  onRepeatConsumed: () => void;
  onJobCreated: (job: Job) => void;
};

const audioPresets: DownloadPreset[] = ["audioMp3", "audioM4a", "audioOpus", "audioSource", "audioFlac"];
type DownloadMode = "video" | "audio" | "subtitles";
type DuplicateKind = DownloadMode;
type DuplicateErrorState = { kind: DuplicateKind; signature: string };

export function Downloader({
  initialWorkspace,
  workspacePersistenceEnabled = false,
  workspaceKey = "new",
  onWorkspaceChange,
  settingsResetVersion = 0,
  musicMode = false,
  audioEncoders = null,
  sourceHeaderAction,
  authSettings,
  defaultDestinationDir,
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
  const [mode, setMode] = useState<DownloadMode>(musicMode ? "audio" : "video");
  const [preset, setPreset] = useState<DownloadPreset>(musicMode ? "audioSource" : "bestVideo");
  const [musicEdits, setMusicEdits] = useState<MusicEdits>({});
  const [musicCollection, setMusicCollection] = useState<Parameters<typeof withMusicContext>[3]>();
  const [musicQuality, setMusicQuality] = useState("best");
  const [videoProfile, setVideoProfile] = useState<VideoDownloadProfile>(() => loadSavedVideoProfile());
  const [selectedVideoFormatId, setSelectedVideoFormatId] = useState<string | null>(null);
  const [selectedAudioFormatId, setSelectedAudioFormatId] = useState<string | null>(null);
  const [selectedSubtitleKey, setSelectedSubtitleKey] = useState<string | null>(null);
  const [selectedSubtitleFormat, setSelectedSubtitleFormat] = useState<string | null>(null);
  const [audioBitrate, setAudioBitrate] = useState("320K");
  const [audioChannels, setAudioChannels] = useState(musicMode ? "source" : "stereo");
  const [embedMetadata, setEmbedMetadata] = useState(musicMode);
  const [embedThumbnail, setEmbedThumbnail] = useState(musicMode);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<DuplicateErrorState | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isEnqueueing, setIsEnqueueing] = useState(false);
  const [pendingHistoryDuplicate, setPendingHistoryDuplicate] = useState<DownloadRequest | null>(null);
  const [enqueueResult, setEnqueueResult] = useState<{ mode: DownloadMode; id: number } | null>(null);
  const noticeSequence = useRef(0);
  const restoredRepeat = useRef<string | null>(null);
  const previousDefaultDestinationDir = useRef<string | null>(null);
  const analysisSequence = useRef(0);
  const restoredWorkspaceConsumed = useRef(false);
  const restoredWorkspaceUrl = useRef<string | null>(null);
  const restoredWorkspaceAuth = useRef<string | null>(null);
  const restoredWorkspaceDraftUrl = useRef<string | null>(null);
  const metadataUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!enqueueResult) return;
    const timeout = window.setTimeout(() => setEnqueueResult(null), noticeDurationMs);
    return () => window.clearTimeout(timeout);
  }, [enqueueResult]);
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
  }) + (musicMode ? JSON.stringify([musicEdits, musicQuality]) : "");

  useEffect(() => {
    if (!musicMode || !media || mode !== "audio") return;
    setSelectedAudioFormatId(selectMusicAudio(media.audioFormats, preset, musicQuality)?.formatId ?? null);
  }, [musicMode, media, mode, preset, musicQuality]);

  useEffect(() => {
    if (defaultDestinationDir === undefined) {
      api.getDefaultDownloadDir().then(setDestinationDir).catch(() => setDestinationDir("Downloads"));
      return;
    }
    if (!defaultDestinationDir) return;
    setDestinationDir((current) =>
      !current || current === previousDefaultDestinationDir.current
        ? defaultDestinationDir
        : current,
    );
    previousDefaultDestinationDir.current = defaultDestinationDir;
  }, [defaultDestinationDir]);

  useEffect(() => {
    const currentUrl = url.trim();
    const authKey = JSON.stringify([authSettings.useBrowserCookies, authSettings.useYoutubeSession, authSettings.browser]);
    if (restoredWorkspaceUrl.current === currentUrl && sourceIsVideo && restoredWorkspaceAuth.current === authKey) return;
    restoredWorkspaceUrl.current = null;
    restoredWorkspaceDraftUrl.current = null;
    if (!restoredWorkspaceConsumed.current && initialWorkspace?.url === currentUrl && sourceIsVideo) {
      restoredWorkspaceConsumed.current = true;
      const saved = initialWorkspace;
      restoredWorkspaceDraftUrl.current = currentUrl;
      setMode(saved.mode); setPreset(saved.preset); setDestinationDir(saved.destinationDir);
      setVideoProfile(saved.videoProfile); setSelectedVideoFormatId(saved.selectedVideoFormatId);
      setSelectedAudioFormatId(saved.selectedAudioFormatId); setSelectedSubtitleKey(saved.selectedSubtitleKey);
      setSelectedSubtitleFormat(saved.selectedSubtitleFormat); setAudioBitrate(saved.audioBitrate);
      setAudioChannels(saved.audioChannels); setEmbedMetadata(saved.embedMetadata); setEmbedThumbnail(saved.embedThumbnail);
      setMusicQuality(saved.musicQuality); setMusicEdits(saved.musicEdits); setMusicCollection(saved.musicCollection);
      if (saved.media) {
        restoredWorkspaceUrl.current = currentUrl;
        restoredWorkspaceAuth.current = authKey;
        setMedia(saved.media); setAnalyzedUrl(currentUrl); setIsAnalyzing(false); setError(null);
        return;
      }
    }
    const analysisId = `${musicMode ? "music" : "single"}-${Date.now()}-${++analysisSequence.current}`;
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
          analysisId,
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
        setAudioChannels(musicMode || result.audioFormats.find((format) => format.formatId === bestAudioFormatId)?.audioChannels === 1 ? "source" : "stereo");
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
      void api.cancelUrlAnalysis(analysisId).catch(() => undefined);
    };
  }, [url, sourceIsVideo, authSettings.useBrowserCookies, authSettings.useYoutubeSession, authSettings.browser, locale, t, initialWorkspace]);

  useEffect(() => {
    if (metadataUrl.current === url.trim()) return;
    metadataUrl.current = url.trim();
    if (restoredWorkspaceDraftUrl.current !== url.trim()) { setMusicEdits({}); setMusicCollection(undefined); }
  }, [url]);

  useEffect(() => {
    if (!workspacePersistenceEnabled || !sourceIsVideo || !url.trim()) return;
    onWorkspaceChange?.(workspaceKey, {
      kind: "single", url: url.trim(), media: analyzedUrl === url.trim() ? media : null,
      mode, preset, destinationDir, videoProfile, selectedVideoFormatId, selectedAudioFormatId,
      selectedSubtitleKey, selectedSubtitleFormat, audioBitrate, audioChannels, embedMetadata, embedThumbnail,
      musicQuality, musicEdits, musicCollection,
    });
  }, [workspacePersistenceEnabled, workspaceKey, onWorkspaceChange, url, sourceIsVideo, analyzedUrl, media,
    mode, preset, destinationDir, videoProfile, selectedVideoFormatId, selectedAudioFormatId,
    selectedSubtitleKey, selectedSubtitleFormat, audioBitrate, audioChannels, embedMetadata, embedThumbnail,
    musicQuality, musicEdits, musicCollection]);

  useEffect(() => {
    const request = repeatDraft?.request;
    if (!repeatDraft || !request) return;
    setDestinationDir(request.destinationDir);
    setAudioBitrate(request.audioBitrate ?? "320K");
    setAudioChannels(request.audioChannels ?? "source");
    setEmbedMetadata(request.embedMetadata ?? false);
    setEmbedThumbnail(request.embedThumbnail ?? false);
    if (musicMode && request.music) {
      setMusicEdits(request.music.metadata);
      setMusicQuality(request.music.sourceQuality ?? "best");
      setMusicCollection(request.music.collectionKind === "single" ? undefined : {
        kind: request.music.collectionKind,
        createAlbumFolder: request.music.createAlbumFolder,
        title: request.music.collectionTitle ?? "",
        index: request.music.metadata.trackNumber ?? 1,
      });
    }
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
      setSelectedAudioFormatId(musicMode ? selectMusicAudio(media.audioFormats, request.preset, request.music?.sourceQuality)?.formatId ?? null : bestFormatId(media.audioFormats));
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
    const request: DownloadRequest = {
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
      audioBitrate: mode === "audio" && (!musicMode || preset === "audioMp3") ? audioBitrate : null,
      audioChannels: mode === "audio" ? audioChannels : null,
      embedMetadata: mode === "audio" ? embedMetadata : null,
      embedThumbnail: mode === "audio" ? embedThumbnail : null,
      subtitle: mode === "subtitles" ? selectedSubtitleRequest() : null,
    };
    return musicMode && media ? withMusicContext(request, media, musicEdits, musicCollection, musicQuality) : request;
  }

  async function submitRequest(request: DownloadRequest, submittedDuplicateSignature: string | null) {
    try {
      const job = await api.enqueueDownload(request);
      onJobCreated(job);
      setEnqueueResult({
        id: ++noticeSequence.current,
        mode: request.preset === "subtitles"
          ? "subtitles"
          : audioPresets.includes(request.preset)
            ? "audio"
            : "video",
      });
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
      setPreset((current) => (audioPresets.includes(current) ? current : musicMode ? "audioSource" : "audioMp3"));
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

  const appliedSettingsReset = useRef(0);
  useEffect(() => {
    if (appliedSettingsReset.current === settingsResetVersion) return;
    appliedSettingsReset.current = settingsResetVersion;
    setDestinationDir(defaultDestinationDir ?? "Downloads");
    setMode(musicMode ? "audio" : "video");
    setPreset(musicMode ? "audioSource" : "bestVideo");
    setMusicQuality("best");
    setVideoProfile("best");
    const resolved = media ? resolveVideoProfile("best", media.videoFormats, media.audioFormats) : null;
    setSelectedVideoFormatId(resolved?.videoFormatId ?? null);
    setSelectedAudioFormatId(resolved?.audioFormatId ?? null);
    setAudioBitrate("320K");
    setAudioChannels(musicMode ? "source" : "stereo");
    setEmbedMetadata(musicMode);
    setEmbedThumbnail(musicMode);
    selectSubtitle(media?.subtitles?.[0] ?? null);
  }, [settingsResetVersion, defaultDestinationDir, musicMode, media]);

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
    if (musicMode && mode === "audio") return musicAudioLabel(preset, media?.audioFormats.find((format) => format.formatId === selectedAudioFormatId), audioBitrate);
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
    if (musicMode && mode === "audio" && (!media || !musicConversionAvailable(preset, media.audioFormats.find((format) => format.formatId === selectedAudioFormatId), audioEncoders))) return false;
    if (musicMode && mode === "video" && !musicClipAvailable()) return false;
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

  function musicClipAvailable() {
    const video = media?.videoFormats.find((format) => format.formatId === selectedVideoFormatId);
    return Boolean(video && (video.hasAudio || media?.audioFormats.some((format) => format.formatId === selectedAudioFormatId)));
  }

  const enqueueNotice = enqueueResult ? (
    <div className={`${musicMode ? "playlist-batch-feedback all-added" : "inline-notice success-notice"} single-enqueue-result`} role="status">
      <NoticeCountdown key={enqueueResult.id} />
      <strong>
        {enqueueResult.mode === "audio"
          ? t("downloader.enqueuedAudio")
          : enqueueResult.mode === "subtitles"
            ? t("downloader.enqueuedSubtitles")
            : t("downloader.enqueuedVideo")}
      </strong>
      <button type="button" className="secondary" onClick={onOpenQueue}>{t("playlist.openQueue")}</button>
    </div>
  ) : null;

  const preview = (
    <MediaPreview
      music={musicMode}
      url={url}
      media={media}
      onOpen={openAnalyzedUrl}
      onCopy={copyAnalyzedUrl}
    />
  );

  return (
    <section className={`download-panel download-source-panel${musicMode ? " music-single" : ""}`} aria-label={t(musicMode ? "nav.music" : "downloader.label")}>
      <form onSubmit={enqueue}>
        <div className="playlist-url-card source-url-card">
          <UrlInput id={musicMode ? "music-track-url" : "video-url"} label={t(musicMode ? "music.url" : "media.url")} heading={t(musicMode ? "music.addUrl" : "media.emptyTitle")} headerAction={sourceHeaderAction} value={url} placeholder={t(musicMode ? "music.urlPlaceholder" : "media.placeholder")} pasteLabel={t("media.paste")} pasteTooltip={t("media.pasteTooltip")} clearLabel={t("media.clear")} onChange={onUrlChange} onPaste={pasteUrlFromClipboard} onClear={clearUrl} />
          {error ? <p className="error source-analysis-feedback" role="alert">{error}</p> : null}
          {isAnalyzing ? <p className="analysis-status source-analysis-feedback" role="status">{t("media.analyzing")}</p> : null}
        </div>
        <div className="download-workspace" data-has-media={Boolean(media) && !isAnalyzing}>
          {musicMode ? <div className="music-single-content">
            {preview}
            {media && !isAnalyzing ? <MusicDownloadSummary
              count={1}
              video={mode === "video"}
              size={mode === "audio" ? musicAudioSize(media, selectedAudioFormatId, preset, audioBitrate, locale, t) : knownSize(media.videoFormats.find((format) => format.formatId === selectedVideoFormatId)?.filesize, media.audioFormats.find((format) => format.formatId === selectedAudioFormatId)?.filesize, t)}
              facts={mode === "audio" ? [
                { label: t("audio.codec"), value: preset === "audioSource" ? t("music.original") : preset.replace("audio", "").toUpperCase() },
                { label: t("music.sourceQuality"), value: musicQuality === "best" ? t("music.best") : t("music.upTo", { bitrate: musicQuality }) },
                ...(preset === "audioMp3" ? [{ label: t("audio.bitrate"), value: audioBitrate.replace("K", " kbps") }] : []),
              ] : summaryFacts(mode, media, selectedVideoFormatId, selectedAudioFormatId, selectedSubtitle(), selectedSubtitleFormat, preset, audioBitrate, audioChannels, t).filter((fact) => fact.label !== t("common.size"))}
              destinationDir={destinationDir}
              onDestinationChange={setDestinationDir}
              onBrowse={chooseDestinationDir}
              action={{
                ariaLabel: t("playlist.enqueueSelected", { count: 1 }),
                label: t("playlist.enqueueSelected", { count: 1 }),
                busy: isEnqueueing, analyzed: true, disabled: isEnqueueing || !canDownload(),
              }}
            >
              {duplicateError ? <p className="download-action-error" role="alert">{t(duplicateErrorTranslationKey(duplicateError.kind))}</p> : null}
              {enqueueNotice}
            </MusicDownloadSummary> : enqueueNotice}
          </div> : preview}

          {media && !isAnalyzing ? <div className={`options-column${musicMode ? " music-download-controls" : ""}`}>
            <section className="mode-section" aria-label={t("downloader.mode")}>
              {musicMode ? <MusicModeTabs mode={mode} onChange={changeMode} /> : <DownloadModeTabs mode={mode} onChange={changeMode} />}
            </section>
            <MusicParametersGroup enabled={musicMode}>
            {musicMode && mode === "video" && media && !musicClipAvailable() ? <p className="music-format-note">{t("music.videoUnavailable")}</p> : null}

            {mode === "video" ? (
              <VideoDownloadOptions
                formats={media?.videoFormats ?? []}
                audioFormats={media?.audioFormats ?? []}
                profile={videoProfile}
                onProfileChange={changeVideoProfile}
                onManualFormatChange={changeManualVideoFormat}
              />
            ) : mode === "audio" && musicMode ? (
              <>
                <MusicAudioOptions preset={preset as MusicAudioPreset} bitrate={audioBitrate} quality={musicQuality} embedMetadata={embedMetadata} embedThumbnail={embedThumbnail} formats={media?.audioFormats ?? []} encoders={audioEncoders} onPreset={setPreset} onBitrate={setAudioBitrate} onQuality={setMusicQuality} onMetadata={setEmbedMetadata} onThumbnail={setEmbedThumbnail} />
                {media ? <MusicMetadataEditor value={{ ...musicMetadata(media), ...musicEdits }} onChange={(patch) => setMusicEdits((current) => ({ ...current, ...patch }))} onReset={() => setMusicEdits({})} /> : null}
              </>
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
            </MusicParametersGroup>
            {!musicMode ? <DownloadSummaryCard
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
            /> : null}
          </div> : null}
        </div>
        {!musicMode ? enqueueNotice : null}
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

function musicAudioSize(media: MediaInfo | null, audioId: string | null, preset: DownloadPreset, bitrate: string, locale: AppLocale, t: Translate) {
  const bytes = musicAudioBytes(media?.audioFormats.find((format) => format.formatId === audioId), preset, bitrate, media?.duration);
  return bytes == null ? t("common.unknown") : t("music.estimatedSizeMb", { size: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 ** 2) });
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
  if (normalized.includes("analysis-error:timeout")) {
    return t("error.analysisTimeout");
  }
  const authError = localizedYoutubeAuthError(message, t);
  if (authError) return authError;
  if (isYouTubeAgeRestrictionError(message)) {
    return t("error.ageRestricted");
  }
  if (isYouTubeBotConfirmationError(message)) {
    return t("error.botConfirmation");
  }
  if (isYouTubeRateLimitError(message)) {
    return t("error.rateLimited");
  }
  if (isYouTubeForbiddenError(message)) {
    return t("error.forbidden");
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
