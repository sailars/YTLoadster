export type ToolState = "Found" | "Missing";

export type AppStatus = {
  name: string;
  ready: boolean;
  platform: string;
};

export type ToolStatus = {
  name: string;
  path?: string | null;
  state: ToolState;
  version?: string | null;
  setupAction?: string | null;
};

export type ToolInventory = {
  ytdlp: ToolStatus;
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
  jsRuntime: ToolStatus;
};

export type FormatOption = {
  formatId: string;
  qualityLabel: string;
  kind: "video" | "audio";
  ext?: string | null;
  codec?: string | null;
  filesize?: number | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  dynamicRange?: string | null;
  audioChannels?: number | null;
};

export type MediaInfo = {
  title: string;
  uploader?: string | null;
  duration?: number | null;
  webpageUrl?: string | null;
  thumbnail?: string | null;
  description?: string | null;
  uploadDate?: string | null;
  viewCount?: number | null;
  videoFormats: FormatOption[];
  audioFormats: FormatOption[];
  subtitles?: SubtitleOption[];
};

export type SubtitleOption = {
  language: string;
  name: string;
  formats: string[];
  automatic: boolean;
};

export type DownloadPreset =
  | "bestVideo"
  | "mp4Video"
  | "audioMp3"
  | "audioM4a"
  | "audioOpus"
  | "subtitles";

export type VideoDownloadProfile =
  | "best"
  | "mp4-1080"
  | "mp4-720"
  | "mp4-480"
  | "mp4-360"
  | "universal"
  | "phone"
  | "tablet"
  | "smart-tv"
  | "legacy"
  | "custom";

export type SubtitleSelection = {
  language: string;
  format: string;
  automatic: boolean;
};

export type CookieSource =
  | { kind: "file"; value: string }
  | { kind: "browser"; value: { browser: string; profile?: string | null } }
  | { kind: "youtubeSession" };

export type BrowserAuthSettings = {
  useBrowserCookies: boolean;
  useYoutubeSession: boolean;
  browser: string;
};

export type YoutubeAuthStatus = {
  supported: boolean;
  authenticated: boolean;
  browser?: string | null;
};

export type YoutubeAuthStart = {
  browser: string;
  websocketUrl?: string | null;
};

export type YoutubeAuthWindowState = {
  open: boolean;
  sessionDetected: boolean;
};

export type YoutubeWebviewAuthState = {
  open: boolean;
  authenticated: boolean;
};

export type YoutubeAuthPhase = "idle" | "opening" | "waiting" | "finishing" | "capturing" | "success" | "cleared" | "error";

export type BrowserCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
};

export type AppSettings = {
  defaultDownloadDir?: string | null;
  ytdlpPath?: string | null;
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
  concurrency: number;
  fragmentConcurrency: number;
  includeVideoTechnicalDetailsInFilename: boolean;
};

export type SettingsPatch = Partial<AppSettings>;

export type VideoTechnicalDetails = {
  height?: number | null;
  fps?: number | null;
  codec?: string | null;
  dynamicRange?: string | null;
  requestedContainer?: string | null;
};

export type DownloadRequest = {
  url: string;
  canonicalSource?: string | null;
  title?: string | null;
  thumbnail?: string | null;
  preset: DownloadPreset;
  formatId?: string | null;
  audioFormatId?: string | null;
  videoProfile?: VideoDownloadProfile | null;
  formatLabel?: string | null;
  includeVideoTechnicalDetailsInFilename?: boolean;
  videoTechnicalDetails?: VideoTechnicalDetails | null;
  destinationDir: string;
  cookieSource?: CookieSource | null;
  audioBitrate?: string | null;
  audioChannels?: string | null;
  embedMetadata?: boolean | null;
  embedThumbnail?: boolean | null;
  subtitle?: SubtitleSelection | null;
};

export type JobState = "Pending" | "Running" | "Paused" | "Completed" | "Failed" | "Cancelled";
export type JobPhase = "Downloading" | "DownloadingVideo" | "DownloadingAudio" | "Merging" | "PostProcessing";

export type Job = {
  id: number;
  request: DownloadRequest;
  state: JobState;
  phase?: JobPhase | null;
  progressPercent?: number | null;
  speed?: string | null;
  eta?: string | null;
  error?: string | null;
};
