import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CookieSource,
  DiskSpace,
  AppStatus,
  DownloadRequest,
  AppSettings,
  Job,
  MediaInfo,
  SettingsPatch,
  ToolInventory,
  UpdateCheckResult,
  YoutubeAuthStart,
  YoutubeAuthStatus,
  YoutubeAuthWindowState,
  YoutubeWebviewAuthState,
  BrowserCookie,
  BatchDownloadItem,
  BatchEnqueueResult,
  DownloadFinishedEvent,
  HistoryCheckItem,
  HistoryDuplicate,
  HistoryItem,
  PlaylistInfo,
  PlaylistItemAnalysis,
} from "./types";

export const api = {
  getAppStatus() {
    return invoke<AppStatus>("get_app_status");
  },
  getToolStatus() {
    return invoke<ToolInventory>("get_tool_status");
  },
  checkForUpdates() {
    return invoke<UpdateCheckResult>("check_for_updates");
  },
  getDefaultDownloadDir() {
    return invoke<string>("get_default_download_dir");
  },
  getAvailableDiskSpace(path: string) {
    return invoke<DiskSpace>("get_available_disk_space", { path });
  },
  getSettings() {
    return invoke<AppSettings>("get_settings");
  },
  updateSettings(patch: SettingsPatch) {
    return invoke<AppSettings>("update_settings", { patch });
  },
  setTrayLocale(locale: "ru" | "en") {
    return invoke<void>("set_tray_locale", { locale });
  },
  async selectDownloadDir(currentDir?: string | null) {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: currentDir ?? undefined,
    });
    return typeof selected === "string" ? selected : null;
  },
  probeUrl(url: string, cookieSource?: CookieSource | null) {
    return invoke<MediaInfo>("probe_url", { url, cookieSource: cookieSource ?? null });
  },
  probePlaylist(url: string, cookieSource?: CookieSource | null) {
    return invoke<PlaylistInfo>("probe_playlist", { url, cookieSource: cookieSource ?? null });
  },
  probePlaylistItem(entryId: string, url: string, cookieSource?: CookieSource | null) {
    return invoke<PlaylistItemAnalysis>("probe_playlist_item", {
      entryId,
      url,
      cookieSource: cookieSource ?? null,
    });
  },
  enqueueDownload(request: DownloadRequest) {
    return invoke<Job>("enqueue_download", { request });
  },
  enqueueDownloadBatch(items: BatchDownloadItem[]) {
    return invoke<BatchEnqueueResult>("enqueue_download_batch", { items });
  },
  checkHistoryDuplicates(items: HistoryCheckItem[]) {
    return invoke<HistoryDuplicate[]>("check_history_duplicates", { items });
  },
  getHistory() {
    return invoke<HistoryItem[]>("get_history");
  },
  removeHistoryItem(id: string) {
    return invoke<void>("remove_history_item", { id });
  },
  clearHistory() {
    return invoke<void>("clear_history");
  },
  getJobs() {
    return invoke<Job[]>("get_jobs");
  },
  cancelJob(id: number) {
    return invoke<void>("cancel_job", { id });
  },
  pauseJob(id: number) {
    return invoke<void>("pause_job", { id });
  },
  pauseAllJobs() {
    return invoke<void>("pause_all_jobs");
  },
  resumeJob(id: number) {
    return invoke<void>("resume_job", { id });
  },
  resumeAllJobs() {
    return invoke<void>("resume_all_jobs");
  },
  cancelAllJobs() {
    return invoke<void>("cancel_all_jobs");
  },
  clearJobs() {
    return invoke<void>("clear_jobs");
  },
  removeJob(id: number) {
    return invoke<void>("remove_job", { id });
  },
  openDownloadFolder(path: string) {
    return invoke<void>("open_download_folder", { path });
  },
  openExternalUrl(url: string) {
    return invoke<void>("open_external_url", { url });
  },
  showSystemNotification(title: string, body: string) {
    return invoke<void>("show_system_notification", { title, body });
  },
  getYoutubeAuthStatus() {
    return invoke<YoutubeAuthStatus>("get_youtube_auth_status");
  },
  startYoutubeAuth(preferredBrowser?: string | null) {
    return invoke<YoutubeAuthStart>("start_youtube_auth", {
      preferredBrowser: preferredBrowser ?? null,
    });
  },
  startYoutubeWebviewAuth() {
    return invoke<YoutubeAuthStart>("start_youtube_webview_auth");
  },
  getYoutubeWebviewAuthState() {
    return invoke<YoutubeWebviewAuthState>("get_youtube_webview_auth_state");
  },
  cancelYoutubeWebviewAuth() {
    return invoke<YoutubeAuthStatus>("cancel_youtube_webview_auth");
  },
  cancelYoutubeAuth() {
    return invoke<YoutubeAuthStatus>("cancel_youtube_auth");
  },
  getYoutubeAuthWindowState() {
    return invoke<YoutubeAuthWindowState>("get_youtube_auth_window_state");
  },
  prepareYoutubeAuthCapture() {
    return invoke<YoutubeAuthStart>("prepare_youtube_auth_capture");
  },
  completeYoutubeAuth(browser: string, cookies: BrowserCookie[]) {
    return invoke<YoutubeAuthStatus>("complete_youtube_auth", { browser, cookies });
  },
  signOutYoutube() {
    return invoke<YoutubeAuthStatus>("sign_out_youtube");
  },
  clearYoutubeAuth() {
    return invoke<YoutubeAuthStatus>("clear_youtube_auth");
  },
  retryJob(id: number) {
    return invoke<Job>("retry_job", { id });
  },
  onDownloadUpdated(callback: (job: Job) => void) {
    return listen<Job>("download-updated", (event) => callback(event.payload));
  },
  onDownloadFinished(callback: (event: DownloadFinishedEvent) => void) {
    return listen<DownloadFinishedEvent>("download-finished", (event) => callback(event.payload));
  },
};
