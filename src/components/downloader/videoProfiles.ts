import type { FormatOption, VideoDownloadProfile } from "../../lib/types";
import { bestFormatId, formatExt, formatFps, formatHeight } from "./videoFormats";

export type ProfileUnavailableReason =
  | "noVideo"
  | "noMp4"
  | "noH264"
  | "noCompatibleResolution"
  | "noAacAudio";

export type ResolvedVideoProfile = {
  profile: VideoDownloadProfile;
  videoFormatId: string | null;
  audioFormatId: string | null;
  available: boolean;
  unavailableReason?: ProfileUnavailableReason;
};

export const videoProfileStorageKey = "ytloadster.videoProfile";

export const namedVideoProfiles: VideoDownloadProfile[] = [
  "best", "mp4-1080", "mp4-720", "mp4-480", "mp4-360", "universal",
  "phone", "tablet", "smart-tv", "legacy",
];

type Rules = { target?: number; maxHeight?: number; maxFps?: number; mp4?: boolean; h264?: boolean; sdr?: boolean; aacRequired?: boolean; prefer720?: boolean };

const profileRules: Partial<Record<VideoDownloadProfile, Rules>> = {
  "mp4-1080": { target: 1080, mp4: true },
  "mp4-720": { target: 720, mp4: true },
  "mp4-480": { target: 480, mp4: true },
  "mp4-360": { target: 360, mp4: true },
  universal: { mp4: true, h264: true, sdr: true, maxHeight: 1080, maxFps: 30, aacRequired: true },
  phone: { mp4: true, h264: true, sdr: true, maxHeight: 1080, maxFps: 30, aacRequired: true, prefer720: true },
  tablet: { mp4: true, h264: true, sdr: true, maxHeight: 1080, maxFps: 60, aacRequired: true },
  "smart-tv": { mp4: true, h264: true, sdr: true, maxHeight: 2160, maxFps: 60, aacRequired: true },
  legacy: { mp4: true, h264: true, sdr: true, maxHeight: 720, maxFps: 30, aacRequired: true },
};

export function resolveVideoProfile(profile: VideoDownloadProfile, videoFormats: FormatOption[], audioFormats: FormatOption[]): ResolvedVideoProfile {
  const video = videoFormats.filter((format) => format.kind === "video");
  if (!video.length) return unavailable(profile, "noVideo");
  if (profile === "best") return resolved(profile, bestFormatId(video), null);
  if (profile === "custom") return resolved(profile, bestFormatId(video), bestAudio(audioFormats)?.formatId ?? null);

  const rules = profileRules[profile]!;
  if (rules.mp4 && !video.some((format) => formatExt(format) === "mp4")) return unavailable(profile, "noMp4");
  if (rules.h264 && !video.some(isH264)) return unavailable(profile, "noH264");
  let candidates = video.filter((format) =>
    (!rules.mp4 || formatExt(format) === "mp4") &&
    (!rules.h264 || isH264(format)) &&
    (!rules.sdr || isSdr(format)) &&
    (!rules.maxHeight || (formatHeight(format) ?? 0) <= rules.maxHeight) &&
    (!rules.maxFps || fps(format) <= rules.maxFps),
  );
  if (!candidates.length) return unavailable(profile, "noCompatibleResolution");

  if (rules.target) {
    candidates = candidates.filter((format) => formatHeight(format) === rules.target);
    if (!candidates.length) return unavailable(profile, "noCompatibleResolution");
  } else if (rules.prefer720) {
    const preferred = candidates.filter((format) => (formatHeight(format) ?? 0) <= 720);
    if (preferred.length) candidates = preferred;
  }

  const audio = rules.aacRequired ? bestAac(audioFormats) : bestAac(audioFormats) ?? bestAudio(audioFormats);
  if (!audio && rules.aacRequired) return unavailable(profile, "noAacAudio");
  return resolved(profile, best(candidates)?.formatId ?? null, audio?.formatId ?? null);
}

export function loadSavedVideoProfile(): VideoDownloadProfile {
  try {
    const value = migrateSavedProfile(window.localStorage.getItem(videoProfileStorageKey));
    return value && namedVideoProfiles.includes(value) ? value : "best";
  } catch { return "best"; }
}

export function saveVideoProfile(profile: VideoDownloadProfile) {
  if (profile === "custom" || !namedVideoProfiles.includes(profile)) return;
  try { window.localStorage.setItem(videoProfileStorageKey, profile); } catch { /* storage is optional */ }
}

function migrateSavedProfile(value: string | null): VideoDownloadProfile | null {
  if (value === "phone-tablet") return "phone";
  if (value === "iphone-ipad" || value === "android") return "tablet";
  return value as VideoDownloadProfile | null;
}

function best(formats: FormatOption[]) {
  return [...formats].sort((a, b) => (formatHeight(b) ?? 0) - (formatHeight(a) ?? 0) || fps(b) - fps(a) || (b.filesize ?? 0) - (a.filesize ?? 0) || a.formatId.localeCompare(b.formatId))[0];
}
function bestAudio(formats: FormatOption[]) {
  return [...formats].filter((format) => format.kind === "audio").sort((a, b) => (b.filesize ?? 0) - (a.filesize ?? 0) || a.formatId.localeCompare(b.formatId))[0];
}
function bestAac(formats: FormatOption[]) { return bestAudio(formats.filter(isAac)); }
function isAac(format: FormatOption) { return formatExt(format) === "m4a" || /^(mp4a|aac)/i.test(format.codec ?? ""); }
function isH264(format: FormatOption) { return /^(avc|h264)/i.test(format.codec ?? ""); }
function isSdr(format: FormatOption) { return !/(hdr|dolby|dv)/i.test(format.dynamicRange ?? ""); }
function fps(format: FormatOption) { return Number((formatFps(format) ?? "0").replace("fps", "")); }
function resolved(profile: VideoDownloadProfile, videoFormatId: string | null, audioFormatId: string | null): ResolvedVideoProfile { return { profile, videoFormatId, audioFormatId, available: Boolean(videoFormatId) }; }
function unavailable(profile: VideoDownloadProfile, unavailableReason: ProfileUnavailableReason): ResolvedVideoProfile { return { profile, videoFormatId: null, audioFormatId: null, available: false, unavailableReason }; }
