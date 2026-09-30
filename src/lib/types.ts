export type ToolState = "Found" | "Missing";

export type AppStatus = {
  name: string;
  ready: boolean;
  platform: string;
};

export type DiskSpace = {
  available: number;
  total: number;
};

export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
};

export type UpdateCheckState = {
  status: "idle" | "checking" | "upToDate" | "available" | "error";
  result?: UpdateCheckResult;
};

export type ComponentId = "ytdlp" | "deno" | "ffmpeg";

export type ComponentUpdateStatus = {
  id: ComponentId;
  currentVersion: string | null;
  latestVersion: string | null;
  state: "available" | "upToDate" | "unavailable";
  sourceUrl: string | null;
};

export type ComponentUpdateCheckState = {
  status: "idle" | "checking" | "ready" | "error";
  results: ComponentUpdateStatus[];
  installingId: ComponentId | null;
  installErrorId: ComponentId | null;
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
  bitrateKbps?: number | null;
};

export type MediaInfo = {
  title: string;
  uploader?: string | null;
  originalLanguage?: string | null;
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
  downloadRetries: number;
  fileAccessRetries: number;
  fragmentRetries: number;
  customUserAgentEnabled: boolean;
  customUserAgent: string;
  includeVideoTechnicalDetailsInFilename: boolean;
  filenameTemplate: "title" | "title-id" | "channel-title" | "date-title";
  filenameCollisionPolicy: "rename" | "replace";
  playlistFormatSelectionMode: PlaylistFormatSelectionMode;
  preventSystemSleepWhileDownloading: boolean;
  minimizeToTray: boolean;
  completionSoundEnabled: boolean;
  showThumbnails: boolean;
  accentColor: "blue" | "purple" | "cyan" | "green" | "orange" | "pink";
  proxyMode: "system" | "none" | "http" | "https" | "socks5";
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPasswordSet: boolean;
};

export type PlaylistFormatSelectionMode = "strict" | "adaptive";

export type SettingsPatch = Partial<AppSettings> & { proxyPassword?: string };

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
  mediaSignature?: string | null;
  request: DownloadRequest;
  state: JobState;
  phase?: JobPhase | null;
  progressPercent?: number | null;
  speed?: string | null;
  eta?: string | null;
  error?: string | null;
};

export type PlaylistInfo = {
  id: string;
  title: string;
  uploader?: string | null;
  webpageUrl?: string | null;
  thumbnail?: string | null;
  totalDuration?: number | null;
  entries: PlaylistEntry[];
};

export type PlaylistEntry = {
  id: string;
  index: number;
  url: string;
  title: string;
  thumbnail?: string | null;
  duration?: number | null;
  availability?: string | null;
};

export type PlaylistItemState =
  | "ready"
  | "requiresAuth"
  | "unavailable"
  | "temporaryError"
  | "error";

export type ProbeIssueCode =
  | "authenticationRequired"
  | "ageRestricted"
  | "privateVideo"
  | "removedVideo"
  | "membershipRequired"
  | "geoRestricted"
  | "forbidden"
  | "rateLimited"
  | "network"
  | "missingTool"
  | "unknown";

export type ProbeIssue = {
  code: ProbeIssueCode;
  message: string;
  retryable: boolean;
  requiresAuth: boolean;
};

export type PlaylistItemAnalysis = {
  entryId: string;
  state: PlaylistItemState;
  media?: MediaInfo | null;
  issue?: ProbeIssue | null;
};

export type BatchDownloadItem = {
  clientId: string;
  request: DownloadRequest;
};

export type BatchEnqueuedItem = {
  clientId: string;
  job: Job;
};

export type BatchRejection = {
  clientId: string;
  code: string;
};

export type BatchEnqueueResult = {
  queued: BatchEnqueuedItem[];
  rejected: BatchRejection[];
};

export type HistoryCheckItem = {
  clientId: string;
  request: DownloadRequest;
};

export type HistoryDuplicate = {
  clientId: string;
  historyId: string;
};

export type HistoryItem = {
  id: string;
  url: string;
  canonicalSource?: string | null;
  title: string;
  thumbnail?: string | null;
  outputPath?: string | null;
  destinationDir?: string | null;
  preset: string;
  formatLabel?: string | null;
  fileSizeBytes?: number | null;
  completedAtMs?: number | null;
  completedAtLegacy?: string | null;
  mediaSignature?: string | null;
  request?: DownloadRequest | null;
};

export type DownloadFinishedEvent = {
  job: Job;
  history?: HistoryItem | null;
  outputPath: string;
  historyError?: string | null;
};
