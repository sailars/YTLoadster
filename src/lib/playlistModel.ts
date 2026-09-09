import type {
  BrowserAuthSettings,
  CookieSource,
  DownloadPreset,
  DownloadRequest,
  FormatOption,
  MediaInfo,
  PlaylistFormatSelectionMode,
  ProbeIssueCode,
  SubtitleOption,
  VideoDownloadProfile,
} from "./types";
import {
  bestFormatId,
  formatCodec,
  formatExt,
  formatHeight,
  predictFinalVideoContainer,
} from "../components/downloader/videoFormats";
import {
  resolveVideoProfile,
  type ProfileUnavailableReason,
} from "../components/downloader/videoProfiles";

export type PlaylistDownloadMode = "video" | "audio" | "subtitles";

export type CountedOption<T extends string | number> = {
  value: T;
  count: number;
};

export type PlaylistFormatOptions = {
  resolutions: CountedOption<number>[];
  fps: CountedOption<number>[];
  containers: CountedOption<string>[];
  codecs: CountedOption<string>[];
};

export type PlaylistParameters = {
  mode: PlaylistDownloadMode;
  videoProfile: VideoDownloadProfile;
  resolution: number | "best";
  fps: number | null;
  container: string | null;
  codec: string | null;
  audioPreset: Extract<DownloadPreset, "audioMp3" | "audioM4a" | "audioOpus">;
  audioBitrate: string;
  audioChannels: "source" | "mono" | "stereo";
  embedMetadata: boolean;
  embedThumbnail: boolean;
  subtitleLanguage: string | null;
  subtitleFormat: string;
  allowAutomaticSubtitles: boolean;
  destinationDir: string;
  includeVideoTechnicalDetailsInFilename: boolean;
  formatSelectionMode: PlaylistFormatSelectionMode;
};

export type PlaylistResolutionWarning =
  | "containerReplaced"
  | "codecReplaced"
  | "fpsReplaced"
  | "resolutionReplaced"
  | "monoSource"
  | "subtitleLanguageReplaced"
  | "subtitleFormatReplaced";

export type ResolvedPlaylistItem = {
  available: boolean;
  reason?: ProfileUnavailableReason | "noAudio" | "noSubtitles" | "destinationMissing" | "noExactMatch";
  request?: DownloadRequest;
  video?: FormatOption | null;
  audio?: FormatOption | null;
  subtitle?: SubtitleOption | null;
  subtitleFormat?: string | null;
  warnings: PlaylistResolutionWarning[];
  replacements?: PlaylistParameterReplacement[];
  estimatedBytes: number | null;
};

export type PlaylistParameterReplacement = {
  parameter: "resolution" | "fps" | "container" | "codec";
  requested: string;
  actual: string;
};

export type PlaylistSizeSummary = {
  bytes: number;
  unknownCount: number;
  calculatingCount: number;
};

export const defaultPlaylistParameters: PlaylistParameters = {
  mode: "video",
  videoProfile: "best",
  resolution: "best",
  fps: null,
  container: null,
  codec: null,
  audioPreset: "audioMp3",
  audioBitrate: "320K",
  audioChannels: "stereo",
  embedMetadata: false,
  embedThumbnail: false,
  subtitleLanguage: null,
  subtitleFormat: "srt",
  allowAutomaticSubtitles: true,
  destinationDir: "",
  includeVideoTechnicalDetailsInFilename: false,
  formatSelectionMode: "strict",
};

export function makeCookieSource(settings: BrowserAuthSettings): CookieSource | null {
  if (settings.useYoutubeSession) return { kind: "youtubeSession" };
  return settings.useBrowserCookies
    ? { kind: "browser", value: { browser: settings.browser, profile: null } }
    : null;
}

export function aggregatePlaylistFormats(mediaItems: MediaInfo[]): PlaylistFormatOptions {
  return {
    resolutions: countedPerMedia(
      mediaItems,
      (media) => media.videoFormats.map(formatHeight).filter(isNumber),
      (left, right) => right - left,
    ),
    fps: countedPerMedia(
      mediaItems,
      (media) => media.videoFormats.map(formatFpsNumber).filter(isNumber),
      (left, right) => right - left,
    ),
    containers: countedPerMedia(
      mediaItems,
      (media) => media.videoFormats.map(formatExt).filter(isText),
      (left, right) => left.localeCompare(right),
    ),
    codecs: countedPerMedia(
      mediaItems,
      (media) => media.videoFormats.map(formatCodec).filter(isText),
      (left, right) => left.localeCompare(right),
    ),
  };
}

export function resolvePlaylistItem(
  media: MediaInfo,
  params: PlaylistParameters,
  sourceUrl: string,
  cookieSource: CookieSource | null,
): ResolvedPlaylistItem {
  if (!params.destinationDir.trim()) return unavailable("destinationMissing");
  if (params.mode === "audio") return resolveAudio(media, params, sourceUrl, cookieSource);
  if (params.mode === "subtitles") return resolveSubtitles(media, params, sourceUrl, cookieSource);
  return resolveVideo(media, params, sourceUrl, cookieSource);
}

export function summarizePlaylistSize(
  rows: Array<{ selected: boolean; analyzing: boolean; resolved?: ResolvedPlaylistItem | null }>,
): PlaylistSizeSummary {
  let bytes = 0;
  let unknownCount = 0;
  let calculatingCount = 0;
  for (const row of rows) {
    if (!row.selected) continue;
    if (row.analyzing || !row.resolved) {
      calculatingCount += 1;
    } else if (row.resolved.available && row.resolved.estimatedBytes == null) {
      unknownCount += 1;
    } else if (row.resolved.estimatedBytes != null) {
      bytes += row.resolved.estimatedBytes;
    }
  }
  return { bytes, unknownCount, calculatingCount };
}

export function retryAfterAuthentication(code?: ProbeIssueCode | null) {
  return code === "authenticationRequired" || code === "ageRestricted" || code === "privateVideo";
}

export function mediaSignatureForRequest(request: DownloadRequest) {
  const canonicalSource = (request.canonicalSource ?? request.url).trim();
  if (request.preset === "bestVideo" || request.preset === "mp4Video") {
    return JSON.stringify({
      Video: {
        canonical_source: canonicalSource,
        video_format_id: normalizedText(request.formatId),
        audio_format_id: normalizedText(request.audioFormatId),
        requested_container: normalizedText(
          request.videoTechnicalDetails?.requestedContainer
            ?? (request.preset === "mp4Video" ? "mp4" : null),
        )?.toLowerCase() ?? null,
      },
    });
  }
  if (request.preset === "audioMp3" || request.preset === "audioM4a" || request.preset === "audioOpus") {
    return JSON.stringify({
      Audio: {
        canonical_source: canonicalSource,
        audio_format_id: normalizedText(request.formatId),
        output_format: request.preset === "audioM4a" ? "m4a" : request.preset === "audioOpus" ? "opus" : "mp3",
        bitrate: normalizedText(request.audioBitrate)?.toLowerCase() ?? null,
        channels: request.audioChannels === "mono" || request.audioChannels === "stereo" ? request.audioChannels : "source",
        embed_metadata: request.embedMetadata ?? false,
        embed_thumbnail: request.embedThumbnail ?? false,
      },
    });
  }
  if (request.preset === "subtitles" && request.subtitle) {
    return JSON.stringify({
      Subtitles: {
        canonical_source: canonicalSource,
        language: request.subtitle.language.trim().toLowerCase(),
        format: request.subtitle.format.trim().toLowerCase(),
        automatic: request.subtitle.automatic,
      },
    });
  }
  return null;
}

function resolveVideo(
  media: MediaInfo,
  params: PlaylistParameters,
  sourceUrl: string,
  cookieSource: CookieSource | null,
): ResolvedPlaylistItem {
  let video: FormatOption | undefined;
  let audio: FormatOption | undefined;
  const warnings: PlaylistResolutionWarning[] = [];
  let preset: DownloadPreset = "bestVideo";
  let replacementParams = params;

  if (params.videoProfile !== "custom") {
    const profile = resolveVideoProfile(params.videoProfile, media.videoFormats, media.audioFormats);
    if (profile.available) {
      video = media.videoFormats.find((item) => item.formatId === profile.videoFormatId);
      audio = media.audioFormats.find((item) => item.formatId === profile.audioFormatId);
      preset = params.videoProfile === "best" ? "bestVideo" : "mp4Video";
    } else {
      const target = qualityProfileHeight(params.videoProfile);
      if (params.formatSelectionMode === "strict" || target == null) {
        return unavailable(profile.unavailableReason ?? "noVideo");
      }
      replacementParams = {
        ...params,
        resolution: target,
        fps: null,
        container: "mp4",
        codec: null,
      };
      video = selectAdaptiveVideoFormat(
        media.videoFormats.filter((format) => formatExt(format) === "mp4"),
        replacementParams,
        warnings,
      );
      if (!video) return unavailable(profile.unavailableReason ?? "noVideo");
      audio = selectBestAudio(media.audioFormats);
      preset = "mp4Video";
    }
  } else {
    if (!media.videoFormats.some((format) => format.kind === "video")) return unavailable("noVideo");
    video = params.formatSelectionMode === "strict"
      ? selectStrictVideoFormat(media.videoFormats, params)
      : selectAdaptiveVideoFormat(media.videoFormats, params, warnings);
    if (!video && params.formatSelectionMode === "strict") return unavailable("noExactMatch");
    audio = selectBestAudio(media.audioFormats);
  }

  if (!video) return unavailable("noVideo");
  const actualContainer = predictFinalVideoContainer(video, audio);
  const videoCodec = formatCodec(video);
  const label = [
    actualContainer?.toUpperCase(),
    formatHeight(video) ? `${formatHeight(video)}p` : null,
    formatFpsNumber(video) ? `${formatFpsNumber(video)}fps` : null,
    [videoCodec, audio ? formatCodec(audio) : null].filter(Boolean).join(" + "),
  ].filter(Boolean).join(" ");

  return {
    available: true,
    video,
    audio: audio ?? null,
    warnings,
    replacements: video ? videoParameterReplacements(video, replacementParams, warnings) : [],
    estimatedBytes: combinedStreamSize(video, audio, media.duration),
    request: {
      url: sourceUrl,
      canonicalSource: media.webpageUrl ?? sourceUrl,
      title: media.title,
      thumbnail: media.thumbnail ?? null,
      preset,
      formatId: video.formatId,
      audioFormatId: audio?.formatId ?? null,
      videoProfile: params.videoProfile,
      formatLabel: label,
      includeVideoTechnicalDetailsInFilename: params.includeVideoTechnicalDetailsInFilename,
      videoTechnicalDetails: {
        height: formatHeight(video),
        fps: formatFpsNumber(video),
        codec: videoCodec || null,
        dynamicRange: video.dynamicRange ?? null,
        requestedContainer: formatExt(video),
      },
      destinationDir: params.destinationDir,
      cookieSource,
      audioBitrate: null,
      audioChannels: null,
      embedMetadata: null,
      embedThumbnail: null,
      subtitle: null,
    },
  };
}

export function qualityProfileHeight(profile: VideoDownloadProfile) {
  switch (profile) {
    case "mp4-1080": return 1080;
    case "mp4-720": return 720;
    case "mp4-480": return 480;
    case "mp4-360": return 360;
    default: return null;
  }
}

function selectStrictVideoFormat(formats: FormatOption[], params: PlaylistParameters) {
  let candidates = formats.filter((format) => format.kind === "video");
  if (!candidates.length) return undefined;
  if (params.resolution !== "best") {
    candidates = candidates.filter((format) => formatHeight(format) === params.resolution);
  }
  if (params.fps != null) {
    candidates = candidates.filter((format) => formatFpsNumber(format) === params.fps);
  }
  if (params.container) {
    const requestedContainer = params.container.toLowerCase();
    candidates = candidates.filter((format) => (formatExt(format) ?? "").toLowerCase() === requestedContainer);
  }
  if (params.codec) {
    candidates = candidates.filter((format) => formatCodec(format).toLowerCase() === params.codec!.toLowerCase());
  }
  return [...candidates].sort((left, right) =>
    (formatHeight(right) ?? 0) - (formatHeight(left) ?? 0)
    || (formatFpsNumber(right) ?? 0) - (formatFpsNumber(left) ?? 0)
    || (right.filesize ?? 0) - (left.filesize ?? 0)
    || left.formatId.localeCompare(right.formatId)
  )[0];
}

function selectAdaptiveVideoFormat(
  formats: FormatOption[],
  params: PlaylistParameters,
  warnings: PlaylistResolutionWarning[],
) {
  let candidates = formats.filter((format) => format.kind === "video");
  if (!candidates.length) return undefined;

  const chosenHeight = selectNearestNumber(
    Array.from(new Set(candidates.map(formatHeight).filter(isNumber))),
    params.resolution,
  );
  if (chosenHeight != null) {
    if (params.resolution !== "best" && chosenHeight !== params.resolution) warnings.push("resolutionReplaced");
    candidates = candidates.filter((format) => formatHeight(format) === chosenHeight);
  }

  if (params.fps != null) {
    const chosenFps = selectNearestNumber(
      Array.from(new Set(candidates.map(formatFpsNumber).filter(isNumber))),
      params.fps,
    );
    if (chosenFps != null) {
      if (chosenFps !== params.fps) warnings.push("fpsReplaced");
      candidates = candidates.filter((format) => formatFpsNumber(format) === chosenFps);
    }
  }

  candidates = preferTextValue(candidates, params.container, formatExt, "containerReplaced", warnings);
  candidates = preferTextValue(candidates, params.codec, formatCodec, "codecReplaced", warnings);
  return bestBySize(candidates);
}

function videoParameterReplacements(
  video: FormatOption,
  params: PlaylistParameters,
  warnings: PlaylistResolutionWarning[],
): PlaylistParameterReplacement[] {
  const replacements: PlaylistParameterReplacement[] = [];
  if (warnings.includes("resolutionReplaced") && params.resolution !== "best") {
    replacements.push({ parameter: "resolution", requested: `${params.resolution}p`, actual: `${formatHeight(video) ?? "-"}p` });
  }
  if (warnings.includes("fpsReplaced") && params.fps != null) {
    replacements.push({ parameter: "fps", requested: `${params.fps} FPS`, actual: `${formatFpsNumber(video) ?? "-"} FPS` });
  }
  if (warnings.includes("containerReplaced") && params.container) {
    replacements.push({ parameter: "container", requested: params.container.toUpperCase(), actual: (formatExt(video) ?? "-").toUpperCase() });
  }
  if (warnings.includes("codecReplaced") && params.codec) {
    replacements.push({ parameter: "codec", requested: params.codec, actual: formatCodec(video) });
  }
  return replacements;
}

function resolveAudio(
  media: MediaInfo,
  params: PlaylistParameters,
  sourceUrl: string,
  cookieSource: CookieSource | null,
): ResolvedPlaylistItem {
  const audio = selectBestAudio(media.audioFormats);
  if (!audio) return unavailable("noAudio");
  const warnings: PlaylistResolutionWarning[] = [];
  const channels = params.audioChannels === "stereo" && audio.audioChannels === 1
    ? "source"
    : params.audioChannels;
  if (channels !== params.audioChannels) warnings.push("monoSource");
  const output = params.audioPreset === "audioM4a" ? "M4A" : params.audioPreset === "audioOpus" ? "OPUS" : "MP3";

  return {
    available: true,
    audio,
    warnings,
    estimatedBytes: convertedAudioSize(params.audioBitrate, media.duration),
    request: {
      url: sourceUrl,
      canonicalSource: media.webpageUrl ?? sourceUrl,
      title: media.title,
      thumbnail: media.thumbnail ?? null,
      preset: params.audioPreset,
      formatId: audio.formatId,
      audioFormatId: null,
      videoProfile: null,
      formatLabel: `${output} ${params.audioBitrate}`,
      includeVideoTechnicalDetailsInFilename: false,
      videoTechnicalDetails: null,
      destinationDir: params.destinationDir,
      cookieSource,
      audioBitrate: params.audioBitrate,
      audioChannels: channels,
      embedMetadata: params.embedMetadata,
      embedThumbnail: params.embedThumbnail,
      subtitle: null,
    },
  };
}

function resolveSubtitles(
  media: MediaInfo,
  params: PlaylistParameters,
  sourceUrl: string,
  cookieSource: CookieSource | null,
): ResolvedPlaylistItem {
  const subtitles = media.subtitles ?? [];
  const subtitle = chooseSubtitle(subtitles, params.subtitleLanguage, media.originalLanguage, params.allowAutomaticSubtitles);
  if (!subtitle) return unavailable("noSubtitles");
  const warnings: PlaylistResolutionWarning[] = [];
  if (params.subtitleLanguage && subtitle.language !== params.subtitleLanguage) warnings.push("subtitleLanguageReplaced");
  const format = chooseSubtitleFormat(subtitle.formats, params.subtitleFormat);
  if (format !== params.subtitleFormat.toLowerCase()) warnings.push("subtitleFormatReplaced");
  return {
    available: true,
    subtitle,
    subtitleFormat: format,
    warnings,
    estimatedBytes: null,
    request: {
      url: sourceUrl,
      canonicalSource: media.webpageUrl ?? sourceUrl,
      title: media.title,
      thumbnail: media.thumbnail ?? null,
      preset: "subtitles",
      formatId: subtitle.language,
      audioFormatId: null,
      videoProfile: null,
      formatLabel: `${subtitle.name} (${subtitle.language}) ${format.toUpperCase()}`,
      includeVideoTechnicalDetailsInFilename: false,
      videoTechnicalDetails: null,
      destinationDir: params.destinationDir,
      cookieSource,
      audioBitrate: null,
      audioChannels: null,
      embedMetadata: null,
      embedThumbnail: null,
      subtitle: {
        language: subtitle.language,
        format,
        automatic: subtitle.automatic,
      },
    },
  };
}

export function chooseSubtitle(
  subtitles: SubtitleOption[],
  selectedLanguage: string | null,
  originalLanguage: string | null | undefined,
  allowAutomatic: boolean,
) {
  const manual = subtitles.filter((subtitle) => !subtitle.automatic);
  const automatic = subtitles.filter((subtitle) => subtitle.automatic);
  const languageMatches = (subtitle: SubtitleOption, language: string | null | undefined) =>
    Boolean(language) && subtitle.language.toLowerCase() === language!.toLowerCase();
  return manual.find((subtitle) => languageMatches(subtitle, selectedLanguage))
    ?? (allowAutomatic ? automatic.find((subtitle) => languageMatches(subtitle, selectedLanguage)) : undefined)
    ?? manual.find((subtitle) => languageMatches(subtitle, originalLanguage))
    ?? manual[0]
    ?? (allowAutomatic
      ? automatic.find((subtitle) => languageMatches(subtitle, originalLanguage)) ?? automatic[0]
      : undefined);
}

export function chooseSubtitleFormat(formats: string[], selected: string) {
  const normalized = formats.map((format) => format.toLowerCase());
  const requested = selected.toLowerCase();
  if (normalized.includes(requested)) return requested;
  if (normalized.includes("srt")) return "srt";
  if (normalized.includes("vtt")) return "vtt";
  return normalized[0] ?? requested;
}

function selectBestAudio(formats: FormatOption[]) {
  return [...formats]
    .filter((format) => format.kind === "audio")
    .sort((left, right) =>
      (right.bitrateKbps ?? 0) - (left.bitrateKbps ?? 0)
      || (right.filesize ?? 0) - (left.filesize ?? 0)
      || left.formatId.localeCompare(right.formatId),
    )[0];
}

function combinedStreamSize(video: FormatOption, audio: FormatOption | undefined, duration?: number | null) {
  const videoSize = streamSize(video, duration);
  const audioSize = audio ? streamSize(audio, duration) : 0;
  return videoSize == null || audioSize == null ? null : videoSize + audioSize;
}

function streamSize(format: FormatOption, duration?: number | null) {
  if (format.filesize != null) return format.filesize;
  if (format.bitrateKbps != null && duration != null) return Math.round(format.bitrateKbps * 1000 * duration / 8);
  return null;
}

function convertedAudioSize(bitrate: string, duration?: number | null) {
  if (duration == null) return null;
  const kbps = Number(bitrate.match(/\d+/)?.[0] ?? 0);
  return kbps > 0 ? Math.round(kbps * 1000 * duration / 8) : null;
}

function selectNearestNumber(values: number[], requested: number | "best") {
  if (!values.length) return null;
  if (requested === "best") return Math.max(...values);
  if (values.includes(requested)) return requested;
  const lower = values.filter((value) => value < requested);
  if (lower.length) return Math.max(...lower);
  return Math.min(...values.filter((value) => value > requested));
}

function preferTextValue(
  formats: FormatOption[],
  preferred: string | null,
  read: (format: FormatOption) => string | null,
  warning: "containerReplaced" | "codecReplaced",
  warnings: PlaylistResolutionWarning[],
) {
  if (!preferred) return formats;
  const matching = formats.filter((format) => (read(format) ?? "").toLowerCase() === preferred.toLowerCase());
  if (matching.length) return matching;
  warnings.push(warning);
  return formats;
}

function bestBySize(formats: FormatOption[]) {
  return [...formats].sort((left, right) =>
    (right.filesize ?? 0) - (left.filesize ?? 0)
    || (right.bitrateKbps ?? 0) - (left.bitrateKbps ?? 0)
    || left.formatId.localeCompare(right.formatId),
  )[0];
}

function countedPerMedia<T extends string | number>(
  mediaItems: MediaInfo[],
  values: (media: MediaInfo) => T[],
  compare: (left: T, right: T) => number,
) {
  const counts = new Map<T, number>();
  for (const media of mediaItems) {
    for (const value of new Set(values(media))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => compare(left.value, right.value));
}

function formatFpsNumber(format: FormatOption) {
  return format.fps ?? (Number(format.qualityLabel.match(/(\d+)fps/i)?.[1] ?? 0) || null);
}

function isNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isText(value: string | null): value is string {
  return Boolean(value);
}

function normalizedText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function unavailable(reason: ResolvedPlaylistItem["reason"]): ResolvedPlaylistItem {
  return { available: false, reason, warnings: [], estimatedBytes: null };
}
