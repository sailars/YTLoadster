import type { FormatOption } from "../../lib/types";

export type VideoQuickPreset = "best" | "1080p" | "720p" | "480p" | "360p" | "manual";

export type VideoSelection = {
  height: string;
  fps: string;
  ext: string;
  codec: string;
};

const presetHeights: Record<Exclude<VideoQuickPreset, "best" | "manual">, number> = {
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
  "360p": 360,
};

export function formatHeight(format: FormatOption) {
  const height = format.height ?? leadingNumber(format.qualityLabel);
  return height > 0 ? height : null;
}

export function formatFps(format: FormatOption) {
  const fps = format.fps ?? fpsNumber(format.qualityLabel);
  return fps > 0 ? `${fps}fps` : null;
}

export function formatExt(format: FormatOption) {
  const ext = format.ext?.toLowerCase();
  if (ext) {
    return ext;
  }
  const normalized = format.qualityLabel.toLowerCase();
  if (normalized.includes("webm")) {
    return "webm";
  }
  if (normalized.includes("mp4")) {
    return "mp4";
  }
  if (normalized.includes("m4a")) {
    return "m4a";
  }
  if (normalized.includes("opus")) {
    return "opus";
  }
  return null;
}

export function formatCodec(format: FormatOption) {
  const codec = codecFamily(format.codec);
  if (codec) {
    return codec;
  }
  const label = format.qualityLabel.toLowerCase();
  if (label.includes("h.264") || label.includes("avc")) {
    return "H.264";
  }
  if (label.includes("av1")) {
    return "AV1";
  }
  if (label.includes("vp9")) {
    return "VP9";
  }
  return "";
}

export function videoFilterOptions(formats: FormatOption[]) {
  const videoFormats = formats.filter((format) => format.kind === "video");

  return {
    heights: uniqueSorted(
      videoFormats.map(formatHeight).filter((value): value is number => typeof value === "number"),
      (left, right) => right - left,
    ).map(String),
    fps: uniqueSorted(
      videoFormats.map(formatFps).filter((value): value is string => Boolean(value)),
      (left, right) => fpsValue(right) - fpsValue(left),
    ),
    exts: uniqueSorted(
      videoFormats.map(formatExt).filter((value): value is string => Boolean(value)),
      (left, right) => containerSortLabel(left).localeCompare(containerSortLabel(right), "ru"),
    ),
    codecs: uniqueSorted(
      videoFormats.map(formatCodec).filter((value): value is string => Boolean(value)),
      (left, right) => left.localeCompare(right, "ru"),
    ),
  };
}

export function selectClosestFormat(
  formats: FormatOption[],
  selectedFormatId: string | null,
  criteria: Partial<VideoSelection>,
) {
  const selected = formats.find((format) => format.formatId === selectedFormatId) ?? formats[0];
  const current = selectionFromFormat(selected);
  const next = { ...current, ...criteria };
  const strict = formats.filter((format) => matchesVideoSelection(format, next));
  const relaxed = formats.filter((format) => matchesVideoSelection(format, relaxedSelection(next, criteria)));
  return bestFormatId(strict.length > 0 ? strict : relaxed.length > 0 ? relaxed : formats);
}

export function selectFormatForFilters(formats: FormatOption[], filters: VideoSelection) {
  return bestFormatId(formats.filter((format) => matchesVideoSelection(format, filters)));
}

export function isFilterValueAvailable(
  formats: FormatOption[],
  filters: VideoSelection,
  key: keyof VideoSelection,
  value: string,
) {
  return selectFormatForFilters(formats, { ...filters, [key]: value }) !== null;
}

export function selectQuickPresetFormat(
  formats: FormatOption[],
  preset: Exclude<VideoQuickPreset, "best" | "manual">,
) {
  const targetHeight = presetHeights[preset];
  const mp4 = formats.filter((format) => format.kind === "video" && formatExt(format) === "mp4");
  const exact = mp4.filter((format) => formatHeight(format) === targetHeight);
  const lowerOrEqual = mp4.filter((format) => (formatHeight(format) ?? 0) <= targetHeight);
  if (exact.length > 0) {
    return bestFormatId(exact);
  }
  if (lowerOrEqual.length > 0) {
    const bestLowerHeight = Math.max(...lowerOrEqual.map((format) => formatHeight(format) ?? 0));
    return bestFormatId(lowerOrEqual.filter((format) => formatHeight(format) === bestLowerHeight));
  }
  const higher = mp4.filter((format) => (formatHeight(format) ?? Number.MAX_SAFE_INTEGER) > targetHeight);
  if (higher.length > 0) {
    const closestHigherHeight = Math.min(
      ...higher.map((format) => formatHeight(format) ?? Number.MAX_SAFE_INTEGER),
    );
    return bestFormatId(higher.filter((format) => formatHeight(format) === closestHigherHeight));
  }
  return bestFormatId(mp4);
}

export function isQuickPresetAvailable(formats: FormatOption[], preset: VideoQuickPreset) {
  if (preset === "best") {
    return formats.some((format) => format.kind === "video");
  }
  if (preset === "manual") {
    return true;
  }

  const targetHeight = presetHeights[preset];
  return formats.some(
    (format) =>
      format.kind === "video" &&
      formatExt(format) === "mp4" &&
      formatHeight(format) === targetHeight,
  );
}

export function bestFormatId(formats: FormatOption[]) {
  const [best] = [...formats].sort((left, right) => formatScore(right) - formatScore(left));
  return best?.formatId ?? null;
}

function selectionFromFormat(format?: FormatOption): VideoSelection {
  return {
    height: format ? String(formatHeight(format) ?? "all") : "all",
    fps: format ? formatFps(format) ?? "all" : "all",
    ext: format ? formatExt(format) ?? "all" : "all",
    codec: format ? formatCodec(format) || "all" : "all",
  };
}

function matchesVideoSelection(format: FormatOption, selection: VideoSelection) {
  return (
    (selection.height === "all" || String(formatHeight(format) ?? "") === selection.height) &&
    (selection.fps === "all" || formatFps(format) === selection.fps) &&
    (selection.ext === "all" || formatExt(format) === selection.ext) &&
    (selection.codec === "all" || formatCodec(format) === selection.codec)
  );
}

function relaxedSelection(next: VideoSelection, changed: Partial<VideoSelection>): VideoSelection {
  const relaxed: VideoSelection = {
    height: "all",
    fps: "all",
    ext: "all",
    codec: "all",
  };

  for (const key of Object.keys(changed) as Array<keyof VideoSelection>) {
    relaxed[key] = next[key];
  }

  return relaxed;
}

function uniqueSorted<T>(values: T[], compare: (left: T, right: T) => number) {
  return Array.from(new Set(values)).sort(compare);
}

function containerSortLabel(ext: string) {
  switch (ext.toLowerCase()) {
    case "mp4":
      return "MP4";
    case "webm":
      return "WebM";
    case "m4a":
      return "M4A";
    case "opus":
      return "OPUS";
    default:
      return ext.toUpperCase();
  }
}

function codecFamily(codec?: string | null) {
  const normalized = codec?.toLowerCase() ?? "";
  if (normalized.startsWith("av01")) {
    return "AV1";
  }
  if (normalized.startsWith("avc") || normalized.startsWith("h264")) {
    return "H.264";
  }
  if (normalized.startsWith("vp09") || normalized.startsWith("vp9")) {
    return "VP9";
  }
  if (normalized.startsWith("vp8")) {
    return "VP8";
  }
  if (normalized.startsWith("mp4a") || normalized.startsWith("aac")) {
    return "AAC";
  }
  if (normalized.startsWith("opus")) {
    return "Opus";
  }
  if (!normalized || normalized === "none") {
    return "";
  }
  return normalized;
}

function formatScore(format: FormatOption) {
  const quality = formatHeight(format) ?? leadingNumber(format.qualityLabel);
  const fps = fpsValue(formatFps(format) ?? "");
  const size = format.filesize ?? 0;
  return quality * 1_000_000_000 + fps * 1_000_000 + size;
}

function leadingNumber(value: string) {
  return Number(value.match(/^\d+/)?.[0] ?? 0);
}

function fpsNumber(value: string) {
  return Number(value.match(/(\d+)fps/i)?.[1] ?? 0);
}

function fpsValue(value: string) {
  return Number(value.match(/(\d+)/)?.[1] ?? 0);
}
