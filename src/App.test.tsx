import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import App from "./App";
import { sidebarPinnedStorageKey } from "./components/Sidebar";
import { api } from "./lib/api";
import { themeStorageKey } from "./lib/theme";
import { localeStorageKey } from "./lib/i18n";
import { notificationsStorageKey } from "./lib/notifications";
import { automaticUpdateChecksStorageKey } from "./lib/updates";
import type { Job } from "./lib/types";
import "./styles.css";

vi.mock("./lib/api", () => ({
  api: {
    getAppStatus: vi.fn().mockResolvedValue({ name: "YTLoadster", ready: true, platform: "windows" }),
    getDefaultDownloadDir: vi.fn().mockResolvedValue("C:/Users/TestUser/Downloads"),
    getAvailableDiskSpace: vi.fn().mockResolvedValue({ available: 100 * 1024 ** 3, total: 250 * 1024 ** 3 }),
    getSettings: vi.fn().mockResolvedValue({
      concurrency: 2,
      fragmentConcurrency: 1,
      downloadRetries: 3,
      fileAccessRetries: 3,
      fragmentRetries: 3,
      customUserAgentEnabled: false,
      customUserAgent: "",
      includeVideoTechnicalDetailsInFilename: false,
      filenameTemplate: "title",
      filenameCollisionPolicy: "rename",
      playlistFormatSelectionMode: "strict",
      preventSystemSleepWhileDownloading: false,
      minimizeToTray: true,
      completionSoundEnabled: false,
      showThumbnails: true,
      accentColor: "blue",
      proxyMode: "system",
      proxyHost: "",
      proxyPort: 0,
      proxyUsername: "",
      proxyPasswordSet: false,
    }),
    playCompletionSound: vi.fn().mockResolvedValue(undefined),
    getYoutubeAuthStatus: vi.fn().mockResolvedValue({
      supported: true,
      authenticated: false,
      browser: null,
    }),
    startYoutubeAuth: vi.fn().mockResolvedValue({
      browser: "Microsoft Edge",
    }),
    startYoutubeWebviewAuth: vi.fn().mockResolvedValue({
      browser: "WebView2",
    }),
    getYoutubeWebviewAuthState: vi.fn().mockResolvedValue({
      open: true,
      authenticated: false,
    }),
    cancelYoutubeWebviewAuth: vi.fn().mockResolvedValue({
      supported: true,
      authenticated: false,
      browser: null,
    }),
    cancelYoutubeAuth: vi.fn().mockResolvedValue({
      supported: true,
      authenticated: false,
      browser: null,
    }),
    getYoutubeAuthWindowState: vi.fn().mockResolvedValue({
      open: true,
      sessionDetected: false,
      status: { supported: true, authenticated: false, browser: null },
    }),
    signOutYoutube: vi.fn().mockResolvedValue({
      supported: true,
      authenticated: false,
      browser: null,
    }),
    clearYoutubeAuth: vi.fn().mockResolvedValue({
      supported: true,
      authenticated: false,
      browser: null,
    }),
    updateSettings: vi.fn().mockResolvedValue({
      concurrency: 4,
      fragmentConcurrency: 4,
      downloadRetries: 3,
      fileAccessRetries: 3,
      fragmentRetries: 3,
      customUserAgentEnabled: false,
      customUserAgent: "",
      includeVideoTechnicalDetailsInFilename: false,
      filenameTemplate: "title",
      filenameCollisionPolicy: "rename",
      playlistFormatSelectionMode: "strict",
      preventSystemSleepWhileDownloading: false,
      minimizeToTray: true,
      completionSoundEnabled: false,
      showThumbnails: true,
      accentColor: "blue",
      proxyMode: "system",
      proxyHost: "",
      proxyPort: 0,
      proxyUsername: "",
      proxyPasswordSet: false,
    }),
    setTrayLocale: vi.fn().mockResolvedValue(undefined),
    selectDownloadDir: vi.fn().mockResolvedValue("D:/Video"),
    getToolStatus: vi.fn().mockResolvedValue({
      ytdlp: { name: "yt-dlp", state: "Found", path: "C:/app/yt-dlp.exe" },
      ffmpeg: { name: "ffmpeg", state: "Found", path: "C:/app/ffmpeg.exe" },
      ffprobe: { name: "ffprobe", state: "Found", path: "C:/app/ffprobe.exe" },
      jsRuntime: { name: "node", state: "Found", path: "C:/Program Files/nodejs/node.exe" },
    }),
    checkForUpdates: vi.fn().mockResolvedValue({
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      releaseUrl: "https://github.com/sailars/YTLoadster/releases/latest",
    }),
    checkComponentUpdates: vi.fn().mockResolvedValue([]),
    installComponentUpdate: vi.fn().mockResolvedValue("2026.09.01"),
    probeUrl: vi.fn().mockResolvedValue({
      title: "Example Video",
      uploader: "Channel",
      duration: 120,
      webpageUrl: "https://youtube.com/watch?v=x",
      thumbnail: "https://i.ytimg.com/example.jpg",
      description: "Описание видео для проверки превью.",
      uploadDate: "20240512",
      viewCount: 852341,
      videoFormats: [{ formatId: "137", qualityLabel: "1080p 30fps mp4", kind: "video" }],
      audioFormats: [{ formatId: "140", qualityLabel: "128kbps m4a", kind: "audio" }],
      subtitles: [
        { language: "ru", name: "Русский", formats: ["srt", "vtt"], automatic: false },
        { language: "en", name: "English", formats: ["vtt"], automatic: true },
      ],
    }),
    probePlaylist: vi.fn().mockResolvedValue({
      id: "PL-test",
      title: "Example Playlist",
      entries: [],
    }),
    beginPlaylistAnalysis: vi.fn().mockResolvedValue(undefined),
    cancelPlaylistAnalysis: vi.fn().mockResolvedValue(undefined),
    cancelUrlAnalysis: vi.fn().mockResolvedValue(undefined),
    probePlaylistItem: vi.fn(),
    checkHistoryDuplicates: vi.fn().mockResolvedValue([]),
    enqueueDownloadBatch: vi.fn().mockResolvedValue({ queued: [], rejected: [] }),
    getHistory: vi.fn().mockResolvedValue([]),
    removeHistoryItem: vi.fn().mockResolvedValue(undefined),
    clearHistory: vi.fn().mockResolvedValue(undefined),
    enqueueDownload: vi.fn().mockResolvedValue({
      id: 1,
      state: "Pending",
      request: {
        url: "https://youtube.com/watch?v=x",
        title: "Example Video",
        preset: "mp4Video",
        destinationDir: "C:/Users/TestUser/Downloads",
      },
    }),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    removeJob: vi.fn().mockResolvedValue(undefined),
    pauseJob: vi.fn().mockResolvedValue(undefined),
    pauseAllJobs: vi.fn().mockResolvedValue(undefined),
    resumeJob: vi.fn().mockResolvedValue(undefined),
    resumeAllJobs: vi.fn().mockResolvedValue(undefined),
    clearJobs: vi.fn().mockResolvedValue(undefined),
    cancelAllJobs: vi.fn().mockResolvedValue(undefined),
    openDownloadFolder: vi.fn().mockResolvedValue(undefined),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    showSystemNotification: vi.fn().mockResolvedValue(undefined),
    getJobs: vi.fn().mockResolvedValue([]),
    retryJob: vi.fn().mockResolvedValue({
      id: 10,
      state: "Pending",
      request: {
        url: "https://youtube.com/watch?v=retry",
        title: "Retry Video",
        preset: "mp4Video",
        destinationDir: "C:/Users/TestUser/Downloads",
      },
    }),
    onDownloadUpdated: vi.fn().mockResolvedValue(() => undefined),
    onDownloadFinished: vi.fn().mockResolvedValue(() => undefined),
  },
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
    document.documentElement.style.removeProperty("--tt-x");
    document.documentElement.style.removeProperty("--tt-y");
    document.documentElement.style.removeProperty("--tt-r");
    document.documentElement.style.removeProperty("--tt-dur");
    document.documentElement.classList.remove("theme-transition-interactive");
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    vi.mocked(readText).mockResolvedValue("");
    vi.mocked(writeText).mockResolvedValue(undefined);
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    vi.mocked(requestPermission).mockResolvedValue("granted");
    vi.mocked(api.getYoutubeAuthWindowState).mockResolvedValue({
      open: true, sessionDetected: false,
      status: { supported: true, authenticated: false, browser: null },
    });
    vi.mocked(api.checkForUpdates).mockResolvedValue({
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      releaseUrl: "https://github.com/sailars/YTLoadster/releases/latest",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens an unambiguous playlist automatically and keeps its state across sections", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValueOnce({
      id: "PL-routing",
      title: "Routing Playlist",
      entries: [{
        id: "route-item",
        index: 1,
        url: "https://youtube.com/watch?v=route-item",
        title: "Routing Item",
        duration: 90,
      }],
    });
    vi.mocked(api.probePlaylistItem).mockResolvedValueOnce({
      entryId: "route-item",
      state: "ready",
      media: {
        title: "Routing Item",
        webpageUrl: "https://youtube.com/watch?v=route-item",
        duration: 90,
        videoFormats: [{ formatId: "v1", qualityLabel: "720p MP4", kind: "video", height: 720, ext: "mp4", codec: "avc1" }],
        audioFormats: [{ formatId: "a1", qualityLabel: "128kbps M4A", kind: "audio", ext: "m4a", codec: "mp4a" }],
      },
    });
    render(<App />);

    fireEvent.change(screen.getByLabelText(/ссылка на видео/i), {
      target: { value: "https://youtube.com/playlist?list=PL-routing" },
    });
    const playlistButton = screen.getByRole("button", { name: /^Плейлист$/ });
    await waitFor(() => expect(playlistButton).toHaveAttribute("aria-current", "page"), { timeout: 2_000 });
    expect(await screen.findByText("Routing Playlist")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Доступно")).toBeInTheDocument());

    await openQueueSection();
    await userEvent.click(playlistButton);
    expect(screen.getByText("Routing Playlist")).toBeInTheDocument();
    expect(screen.getByText("Доступно")).toBeInTheDocument();
    expect(api.probePlaylist).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /^Новая загрузка$/ }));
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    expect(screen.getByRole("button", { name: /^Новая загрузка$/ })).toHaveAttribute("aria-current", "page");
  });

  it("keeps video and playlist URLs, analyses and selection independent", async () => {
    const videoUrl = "https://youtube.com/watch?v=independent-video";
    const nextVideoUrl = "https://youtube.com/watch?v=independent-video-next";
    const playlistUrl = "https://youtube.com/playlist?list=PL-independent";
    let finishPlaylistItem: ((result: Awaited<ReturnType<typeof api.probePlaylistItem>>) => void) | undefined;
    vi.mocked(api.probePlaylist).mockResolvedValueOnce({
      id: "PL-independent",
      title: "Independent Playlist",
      entries: [{
        id: "independent-item",
        index: 1,
        url: "https://youtube.com/watch?v=independent-item",
        title: "Independent Item",
        duration: 95,
      }],
    });
    vi.mocked(api.probePlaylistItem).mockImplementationOnce(() => new Promise((resolve) => {
      finishPlaylistItem = resolve;
    }));
    render(<App />);

    const videoInput = screen.getByLabelText(/ссылка на видео/i);
    fireEvent.change(videoInput, { target: { value: videoUrl } });
    expect(await screen.findByText("Example Video", {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(api.probeUrl).toHaveBeenCalledWith(videoUrl, null, expect.any(String));

    fireEvent.change(videoInput, { target: { value: playlistUrl } });
    expect(await screen.findByText("Independent Playlist", {}, { timeout: 2_000 })).toBeInTheDocument();
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox", { name: "Ссылка на плейлист" })).toHaveValue(playlistUrl);

    await userEvent.click(screen.getByRole("button", { name: /^Новая загрузка$/ }));
    expect(screen.getByLabelText(/ссылка на видео/i)).toHaveValue(videoUrl);
    expect(screen.getByText("Example Video")).toBeInTheDocument();
    expect(api.probeUrl).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/ссылка на видео/i), { target: { value: nextVideoUrl } });
    await waitFor(() => expect(api.probeUrl).toHaveBeenCalledWith(nextVideoUrl, null, expect.any(String)), { timeout: 2_000 });
    expect(api.probeUrl).toHaveBeenCalledTimes(2);
    const firstVideoAnalysisId = vi.mocked(api.probeUrl).mock.calls[0][2];
    expect(api.cancelUrlAnalysis).toHaveBeenCalledWith(firstVideoAnalysisId);

    await act(async () => {
      finishPlaylistItem?.({
        entryId: "independent-item",
        state: "ready",
        media: {
          title: "Independent Item",
          webpageUrl: "https://youtube.com/watch?v=independent-item",
          duration: 95,
          videoFormats: [{ formatId: "v-independent", qualityLabel: "1080p MP4", kind: "video", height: 1080, ext: "mp4", codec: "avc1" }],
          audioFormats: [{ formatId: "a-independent", qualityLabel: "128kbps M4A", kind: "audio", ext: "m4a", codec: "mp4a" }],
        },
      });
    });

    await userEvent.click(screen.getByRole("button", { name: /^Плейлист$/ }));
    expect(screen.getByRole("textbox", { name: "Ссылка на плейлист" })).toHaveValue(playlistUrl);
    expect(screen.getByText("Independent Playlist")).toBeInTheDocument();
    expect(await screen.findByText("Доступно")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скачать выбранные (1)" })).toBeInTheDocument();
    expect(api.probePlaylist).toHaveBeenCalledTimes(1);
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(1);
  });

  it("offers the single-video choice for a mixed watch and playlist URL", async () => {
    render(<App />);
    const mixedUrl = "https://youtube.com/watch?v=mixed-item&list=PL-mixed";

    fireEvent.change(screen.getByLabelText(/ссылка на видео/i), { target: { value: mixedUrl } });
    expect(await screen.findByRole("dialog", { name: "Ссылка содержит видео и плейлист" }, { timeout: 2_000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Только ролик" }));

    await waitFor(() => expect(api.probeUrl).toHaveBeenCalledWith("https://www.youtube.com/watch?v=mixed-item", null, expect.any(String)), { timeout: 2_000 });
    expect(screen.getByLabelText(/ссылка на видео/i)).toHaveValue("https://www.youtube.com/watch?v=mixed-item");
    expect(screen.getByRole("button", { name: /^Новая загрузка$/ })).toHaveAttribute("aria-current", "page");
  });

  it("offers the entire-playlist choice for a mixed watch and playlist URL", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValueOnce({ id: "PL-mixed", title: "Mixed Playlist", entries: [] });
    render(<App />);
    const mixedUrl = "https://youtube.com/watch?v=mixed-item&list=PL-mixed";

    fireEvent.change(screen.getByLabelText(/ссылка на видео/i), { target: { value: mixedUrl } });
    expect(await screen.findByRole("dialog", { name: "Ссылка содержит видео и плейлист" }, { timeout: 2_000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Весь плейлист" }));

    await waitFor(() => expect(api.probePlaylist).toHaveBeenCalledWith(mixedUrl, null, expect.any(String)), { timeout: 2_000 });
    expect(screen.getByRole("button", { name: /^Плейлист$/ })).toHaveAttribute("aria-current", "page");
  });

  it("analyzes the same mixed playlist URL again after clearing it", async () => {
    const mixedUrl = "https://youtube.com/watch?v=mixed-repeat&list=PL-repeat";
    vi.mocked(api.probePlaylist).mockResolvedValue({ id: "PL-repeat", title: "Repeat Playlist", entries: [] });
    render(<App />);

    fireEvent.change(screen.getByLabelText(/ссылка на видео/i), { target: { value: mixedUrl } });
    await userEvent.click(await screen.findByRole("button", { name: "Весь плейлист" }, { timeout: 2_000 }));
    await waitFor(() => expect(api.probePlaylist).toHaveBeenCalledTimes(1), { timeout: 2_000 });

    const playlistUrl = screen.getByRole("textbox", { name: "Ссылка на плейлист" });
    await userEvent.click(screen.getByRole("button", { name: "Очистить" }));
    expect(playlistUrl).toHaveValue("");

    fireEvent.change(playlistUrl, { target: { value: mixedUrl } });
    await userEvent.click(await screen.findByRole("button", { name: "Весь плейлист" }, { timeout: 2_000 }));

    await waitFor(() => expect(api.probePlaylist).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(screen.getByRole("button", { name: /^Плейлист$/ })).toHaveAttribute("aria-current", "page");

    await userEvent.click(screen.getByRole("button", { name: "Очистить" }));
    await userEvent.click(screen.getByRole("button", { name: /^Новая загрузка$/ }));
    fireEvent.change(screen.getByLabelText(/ссылка на видео/i), { target: { value: mixedUrl } });
    await userEvent.click(await screen.findByRole("button", { name: "Весь плейлист" }, { timeout: 2_000 }));

    await waitFor(() => expect(api.probePlaylist).toHaveBeenCalledTimes(3), { timeout: 2_000 });
    expect(screen.getByRole("button", { name: /^Плейлист$/ })).toHaveAttribute("aria-current", "page");
  });

  it("counts only pending, running and paused jobs in the Queue badge", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      { id: 1, state: "Pending", request: { url: "https://youtu.be/1", preset: "bestVideo", destinationDir: "D:/Video" } },
      { id: 2, state: "Running", request: { url: "https://youtu.be/2", preset: "bestVideo", destinationDir: "D:/Video" } },
      { id: 3, state: "Paused", request: { url: "https://youtu.be/3", preset: "bestVideo", destinationDir: "D:/Video" } },
      { id: 4, state: "Failed", request: { url: "https://youtu.be/4", preset: "bestVideo", destinationDir: "D:/Video" } },
      { id: 5, state: "Cancelled", request: { url: "https://youtu.be/5", preset: "bestVideo", destinationDir: "D:/Video" } },
      { id: 6, state: "Completed", request: { url: "https://youtu.be/6", preset: "bestVideo", destinationDir: "D:/Video" } },
    ]);
    render(<App />);

    const queueButton = screen.getByRole("button", { name: /^Очередь$/ });
    await waitFor(() => expect(queueButton.querySelectorAll(".sidebar-badge")).toHaveLength(2));
    expect([...queueButton.querySelectorAll(".sidebar-badge")].map((badge) => badge.textContent)).toEqual(["3", "3"]);
  });

  it("keeps the mouse-expanded sidebar open until the pointer leaves", async () => {
    render(<App />);

    const sidebar = screen.getByRole("navigation", { name: "Основные разделы" });
    const rail = sidebar.closest(".app-sidebar-rail");
    const pinButton = screen.getByRole("button", { name: "Закрепить боковую панель" });
    expect(sidebar).not.toHaveAttribute("data-pinned");
    expect(sidebar).not.toHaveAttribute("data-expanded");
    expect(rail).not.toHaveAttribute("data-pinned");
    expect(rail).not.toHaveAttribute("data-expanded");
    expect(pinButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.pointerEnter(sidebar);
    expect(sidebar).toHaveAttribute("data-expanded", "true");
    expect(rail).toHaveAttribute("data-expanded", "true");
    await userEvent.click(pinButton);

    expect(sidebar).toHaveAttribute("data-pinned", "true");
    expect(rail).toHaveAttribute("data-pinned", "true");
    expect(screen.getByRole("button", { name: "Открепить боковую панель" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(sidebarPinnedStorageKey)).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: "Открепить боковую панель" }));
    expect(sidebar).not.toHaveAttribute("data-pinned");
    expect(sidebar).toHaveAttribute("data-expanded", "true");
    expect(rail).not.toHaveAttribute("data-pinned");
    expect(rail).toHaveAttribute("data-expanded", "true");
    expect(window.localStorage.getItem(sidebarPinnedStorageKey)).toBe("false");

    await userEvent.click(screen.getByRole("button", { name: /^Плейлист$/ }));
    expect(sidebar).toHaveAttribute("data-expanded", "true");
    expect(rail).toHaveAttribute("data-expanded", "true");

    vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 220,
      bottom: 800,
      width: 220,
      height: 800,
      toJSON: () => ({}),
    });
    fireEvent(sidebar, new MouseEvent("pointerout", {
      bubbles: true,
      clientX: 48,
      clientY: 700,
    }));
    expect(sidebar).toHaveAttribute("data-expanded", "true");
    expect(rail).toHaveAttribute("data-expanded", "true");

    fireEvent(sidebar, new MouseEvent("pointerout", {
      bubbles: true,
      clientX: 240,
      clientY: 700,
    }));
    expect(sidebar).not.toHaveAttribute("data-expanded");
    expect(rail).not.toHaveAttribute("data-expanded");
  });

  it("switches and persists the application theme from the header", async () => {
    render(<App />);

    const settingsButton = screen.getByRole("button", { name: /настройки/i });
    const utilities = settingsButton.closest<HTMLElement>(".header-utilities");
    const notificationButton = screen.getByRole("button", { name: /включить уведомления/i });
    const themeButton = screen.getByRole("button", { name: /включить тёмную тему/i });

    expect(utilities).not.toBeNull();
    expect(within(utilities!).getAllByRole("button")).toEqual([notificationButton, themeButton, settingsButton]);
    expect(themeButton).toHaveAttribute("aria-pressed", "false");
    expect(themeButton.querySelector(".system-theme-icon")).toBeInTheDocument();
    expect(themeButton.querySelector(".sidebar-label")).toHaveTextContent("Системная тема");

    await userEvent.click(themeButton);

    const lightThemeButton = screen.getByRole("button", { name: /включить светлую тему/i });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");
    expect(lightThemeButton).toHaveAttribute("aria-pressed", "true");
    expect(lightThemeButton.querySelector(".moon-icon")).toBeInTheDocument();
    expect(lightThemeButton.querySelector(".sidebar-label")).toHaveTextContent("Тёмная тема");

    await userEvent.click(lightThemeButton);
    const systemThemeButton = screen.getByRole("button", { name: /использовать системную тему/i });
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("light");
    expect(systemThemeButton.querySelector(".sun-icon")).toBeInTheDocument();
    expect(systemThemeButton.querySelector(".sidebar-label")).toHaveTextContent("Светлая тема");

    await userEvent.click(systemThemeButton);
    expect(document.documentElement).toHaveAttribute("data-theme-preference", "system");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("system");
    const restoredSystemThemeButton = screen.getByRole("button", { name: /включить тёмную тему/i });
    expect(restoredSystemThemeButton.querySelector(".system-theme-icon")).toBeInTheDocument();
    expect(restoredSystemThemeButton.querySelector(".sidebar-label")).toHaveTextContent("Системная тема");
  });

  it("follows operating system theme changes in system mode", async () => {
    let dark = false;
    let changeListener: (() => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-color-scheme") ? dark : false,
      addEventListener: (_event: string, listener: () => void) => {
        if (query.includes("prefers-color-scheme")) changeListener = listener;
      },
      removeEventListener: vi.fn(),
    })));

    render(<App />);
    expect(document.documentElement).toHaveAttribute("data-theme-preference", "system");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    await act(async () => {
      dark = true;
      changeListener?.();
    });

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("reveals the system theme from the toggle and animates later operating system changes", async () => {
    let systemDark = true;
    let systemChangeListener: (() => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-color-scheme") ? systemDark : false,
      addEventListener: (_event: string, listener: () => void) => {
        if (query.includes("prefers-color-scheme")) systemChangeListener = listener;
      },
      removeEventListener: vi.fn(),
    })));
    window.localStorage.setItem(themeStorageKey, "light");
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    render(<App />);
    const themeButton = screen.getByRole("button", { name: /использовать системную тему/i });
    vi.spyOn(themeButton, "getBoundingClientRect").mockReturnValue({
      x: 8,
      y: 600,
      left: 8,
      top: 600,
      right: 56,
      bottom: 640,
      width: 48,
      height: 40,
      toJSON: () => ({}),
    });

    await userEvent.click(themeButton);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.documentElement).toHaveAttribute("data-theme-preference", "system");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.getPropertyValue("--tt-x")).toBe("32px");
    expect(document.documentElement.style.getPropertyValue("--tt-y")).toBe("620px");
    expect(document.documentElement.style.getPropertyValue("--tt-dur")).toBe("1600ms");
    expect(Number.parseFloat(document.documentElement.style.getPropertyValue("--tt-r"))).toBeGreaterThan(0);

    await waitFor(() => expect(systemChangeListener).toBeTypeOf("function"));
    await act(async () => {
      systemDark = false;
      systemChangeListener?.();
    });

    expect(startViewTransition).toHaveBeenCalledTimes(2);
    expect(document.documentElement).toHaveAttribute("data-theme-preference", "system");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("lets the updated screen receive input after one second while the theme animation continues", async () => {
    let finishTransition: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => { finishTransition = resolve; });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        update();
        return { finished };
      },
    });

    render(<App />);
    vi.useFakeTimers();
    act(() => fireEvent.click(screen.getByRole("button", { name: /включить тёмную тему/i })));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).not.toHaveClass("theme-transition-interactive");
    act(() => vi.advanceTimersByTime(999));
    expect(document.documentElement).not.toHaveClass("theme-transition-interactive");
    act(() => vi.advanceTimersByTime(1));
    expect(document.documentElement).toHaveClass("theme-transition-interactive");

    await act(async () => { finishTransition(); await finished; });
    expect(document.documentElement).not.toHaveClass("theme-transition-interactive");
  });

  it("enables native completion notifications from the header", async () => {
    render(<App />);

    const enableButton = screen.getByRole("button", { name: /включить уведомления/i });
    expect(enableButton.querySelector(".notification-off-icon")).toBeInTheDocument();

    await userEvent.click(enableButton);

    const disableButton = screen.getByRole("button", { name: /выключить уведомления/i });
    expect(disableButton).toHaveAttribute("aria-pressed", "true");
    expect(disableButton.querySelector(".bell-icon")).toBeInTheDocument();
    expect(window.localStorage.getItem(notificationsStorageKey)).toBe("true");
    expect(api.showSystemNotification).toHaveBeenCalledWith(
      "Уведомления включены",
      "Программа сообщит, когда загрузка завершится.",
    );
  });

  it("keeps the bell disabled when Windows rejects the test notification", async () => {
    vi.mocked(api.showSystemNotification).mockRejectedValueOnce(new Error("toast unavailable"));
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /включить уведомления/i }));

    expect(screen.getByRole("button", { name: /включить уведомления/i })).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(notificationsStorageKey)).toBe("false");
  });

  it("keeps the notification control visually stable while permission is pending", async () => {
    let resolvePermission!: (value: boolean) => void;
    vi.mocked(isPermissionGranted).mockImplementationOnce(
      () => new Promise<boolean>((resolve) => {
        resolvePermission = resolve;
      }),
    );
    render(<App />);

    const enableButton = screen.getByRole("button", { name: /включить уведомления/i });
    await userEvent.click(enableButton);

    await waitFor(() => expect(enableButton).toHaveAttribute("aria-busy", "true"));
    expect(enableButton).toHaveAttribute("aria-disabled", "true");
    expect(enableButton).not.toBeDisabled();

    await act(async () => resolvePermission(true));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /выключить уведомления/i })).not.toHaveAttribute("aria-busy");
    });
  });

  it("shows one native notification when a job completes", async () => {
    let onUpdated: ((job: any) => void) | undefined;
    vi.mocked(api.onDownloadUpdated).mockImplementationOnce(async (callback) => {
      onUpdated = callback;
      return () => undefined;
    });
    window.localStorage.setItem(notificationsStorageKey, "true");
    render(<App />);

    await waitFor(() => expect(onUpdated).toBeDefined());
    const completedJob = {
      id: 44,
      state: "Completed" as const,
      request: {
        url: "https://youtube.com/watch?v=done",
        title: "Finished Video",
        preset: "mp4Video" as const,
        destinationDir: "D:/Video",
      },
    };
    await act(async () => {
      onUpdated?.(completedJob);
      onUpdated?.(completedJob);
    });

    await waitFor(() => expect(api.showSystemNotification).toHaveBeenCalledTimes(1));
    expect(api.showSystemNotification).toHaveBeenCalledWith(
      "Загрузка завершена",
      "Файл «Finished Video» успешно сохранён на устройство.",
    );
  });

  it("plays the completion sound once for duplicate completion events", async () => {
    const initialSettings = await api.getSettings();
    vi.mocked(api.getSettings).mockResolvedValueOnce({ ...initialSettings, completionSoundEnabled: true });
    let onUpdated: ((job: Job) => void) | undefined;
    let onFinished: ((event: { job: Job; outputPath: string; history: null }) => void) | undefined;
    vi.mocked(api.onDownloadUpdated).mockImplementationOnce(async (callback) => { onUpdated = callback; return () => undefined; });
    vi.mocked(api.onDownloadFinished).mockImplementationOnce(async (callback) => { onFinished = callback; return () => undefined; });
    render(<App />);
    await waitFor(() => expect(onFinished).toBeDefined());
    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");
    const completedJob: Job = {
      id: 73, state: "Completed",
      request: { url: "https://youtube.com/watch?v=sound", title: "Finished", preset: "mp4Video", destinationDir: "D:/Video" },
    };
    await act(async () => {
      onUpdated?.(completedJob);
      onFinished?.({ job: completedJob, outputPath: "D:/Video/Finished.mp4", history: null });
    });
    expect(api.playCompletionSound).toHaveBeenCalledTimes(1);
  });

  it("restores the saved dark theme", async () => {
    window.localStorage.setItem(themeStorageKey, "dark");

    render(<App />);

    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    const themeButton = screen.getByRole("button", { name: /включить светлую тему/i });
    expect(themeButton.querySelector(".moon-icon")).toBeInTheDocument();
    expect(themeButton.querySelector(".sidebar-label")).toHaveTextContent("Тёмная тема");
  });

  it("applies a saved accent color and shows it selected in Appearance", async () => {
    const initialSettings = await api.getSettings();
    vi.mocked(api.getSettings).mockResolvedValueOnce({ ...initialSettings, accentColor: "purple" });
    render(<App />);
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-accent", "purple"));
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: "Внешний вид" }));
    expect(screen.getByRole("button", { name: "Фиолетовый" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the analyzed video preview actions and clears the URL field", async () => {
    render(<App />);

    const urlInput = screen.getByLabelText(/ссылка на видео/i);
    const pasteButton = screen.getByRole("button", { name: /вставить ссылку из буфера обмена/i });
    const clearButton = screen.getByRole("button", { name: "Очистить" });
    expect(pasteButton).toHaveClass("url-action-button");
    expect(pasteButton).toHaveClass("url-paste-button");
    expect(pasteButton).toHaveTextContent("Вставить");
    expect(pasteButton).toHaveAttribute("title", "Вставить ссылку из буфера обмена");
    expect(pasteButton.querySelector(".url-action-icon")).toBeInTheDocument();
    expect(clearButton).toHaveClass("url-clear-button");
    expect(clearButton).toHaveAttribute("title", "Очистить");
    expect(clearButton.querySelector(".clear-url-icon")).toBeInTheDocument();
    expect(urlInput).toHaveAttribute("data-has-url", "false");
    await userEvent.type(urlInput, "https://youtube.com/watch?v=x");
    expect(urlInput).toHaveAttribute("data-has-url", "true");
    await screen.findByText("Example Video");

    expect(screen.getByRole("img", { name: /превью видео/i })).toHaveAttribute(
      "src",
      "https://i.ytimg.com/example.jpg",
    );
    expect(screen.getByText("Описание видео для проверки превью.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /копировать ссылку/i }));
    expect(writeText).toHaveBeenCalledWith("https://youtube.com/watch?v=x");

    await userEvent.click(screen.getByRole("button", { name: /открыть в браузере/i }));
    expect(api.openExternalUrl).toHaveBeenCalledWith("https://youtube.com/watch?v=x");

    await userEvent.click(clearButton);
    expect(urlInput).toHaveValue("");
    expect(urlInput).toHaveAttribute("data-has-url", "false");
    expect(screen.queryByText("Example Video")).not.toBeInTheDocument();
  });

  it("shows available qualities after analyzing a pasted URL", async () => {
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");

    expect(await screen.findByText("Example Video")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Итоговая загрузка" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Профиль скачивания" })).toHaveTextContent("Лучшее качество");
    expect(screen.queryByRole("button", { name: /анализировать/i })).not.toBeInTheDocument();
  });

  it("shows the best-quality profile before video formats are available", async () => {
    render(<App />);

    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");
    const profile = screen.getByRole("combobox", { name: "Профиль скачивания" });
    expect(profile).toHaveAttribute("data-value", "best");
    expect(profile).toHaveTextContent("Лучшее качество");
  });

  it("selects a 480p profile when the video provides that quality", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "480p Video",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        { formatId: "v720", qualityLabel: "720p 30fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.4d401f", height: 720, fps: 30 },
        { formatId: "v480", qualityLabel: "480p 30fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.4d401e", height: 480, fps: 30 },
      ],
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=480p");
    await screen.findByText("480p Video");
    await selectParameter("Профиль скачивания", "mp4-480");

    const summary = screen.getByRole("region", { name: "Итоговая загрузка" });
    expect(summary).toHaveTextContent("MP4 (H.264)");
    expect(summary).toHaveTextContent("480p");
    expect(summary).toHaveTextContent("30fps");
  });

  it("shows the matching quality tag for profiles and detailed video settings", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Quality tag video",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        { formatId: "v1080", qualityLabel: "1080p 30fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.4d401f", height: 1080, fps: 30 },
        { formatId: "v1440", qualityLabel: "1440p 60fps MP4 AV1", kind: "video" as const, ext: "mp4", codec: "av01.0.12M.10", height: 1440, fps: 60 },
        { formatId: "v2160", qualityLabel: "2160p 60fps MP4 AV1 HDR", kind: "video" as const, ext: "mp4", codec: "av01.0.12M.10", height: 2160, fps: 60, dynamicRange: "HDR" },
        { formatId: "v4320", qualityLabel: "4320p 60fps MP4 AV1", kind: "video" as const, ext: "mp4", codec: "av01.0.12M.10", height: 4320, fps: 60 },
      ],
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=quality-tags");
    await screen.findByText("Quality tag video");
    await selectParameter("Профиль скачивания", "mp4-1080");
    expect(screen.getByLabelText("Характеристики качества")).toHaveTextContent("Full HD");

    await openVideoAdvancedSettings();
    await selectParameter("Разрешение", "2160");
    const tags = screen.getByLabelText("Характеристики качества");
    expect(tags).toHaveTextContent("4K");
    expect(tags).toHaveTextContent("HDR");

    await selectParameter("Разрешение", "1440");
    expect(screen.getByLabelText("Характеристики качества")).toHaveTextContent("2K");
    await selectParameter("Разрешение", "4320");
    expect(screen.getByLabelText("Характеристики качества")).toHaveTextContent("8K");
  });

  it("disables quality profiles that a 240p-only video cannot provide", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "240p Only Video",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        { formatId: "v240", qualityLabel: "240p 30fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.4d4015", height: 240, fps: 30 },
      ],
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=240p-only");
    await screen.findByText("240p Only Video");

    const profileMenu = await openParameterMenu("Профиль скачивания");
    expect(optionByValue(profileMenu, "mp4-1080")).toBeDisabled();
    expect(optionByValue(profileMenu, "mp4-720")).toBeDisabled();
    expect(optionByValue(profileMenu, "mp4-480")).toBeDisabled();
    expect(optionByValue(profileMenu, "mp4-360")).toBeDisabled();

    await userEvent.keyboard("{Escape}");
    await openVideoAdvancedSettings();
    const resolutionMenu = await openParameterMenu("Разрешение");
    expect(optionByValue(resolutionMenu, "480")).toBeDisabled();
    expect(optionByValue(resolutionMenu, "240")).toBeEnabled();
  });

  it("falls back to best quality when the next video lacks the saved quality profile", async () => {
    vi.mocked(api.probeUrl)
      .mockResolvedValueOnce({
        title: "1080p Video",
        uploader: "Channel",
        duration: 120,
        videoFormats: [{ formatId: "v1080", qualityLabel: "1080p 30fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.640028", height: 1080, fps: 30 }],
        audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
      })
      .mockResolvedValueOnce({
        title: "240p Video",
        uploader: "Channel",
        duration: 120,
        videoFormats: [{ formatId: "v240", qualityLabel: "240p 30fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.4d4015", height: 240, fps: 30 }],
        audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
      });
    render(<App />);

    const urlInput = screen.getByLabelText(/ссылка на видео/i);
    await userEvent.type(urlInput, "https://youtube.com/watch?v=1080p");
    await screen.findByText("1080p Video");
    await selectParameter("Профиль скачивания", "mp4-1080");

    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, "https://youtube.com/watch?v=240p");
    await screen.findByText("240p Video");

    const profile = screen.getByRole("combobox", { name: "Профиль скачивания" });
    expect(profile).toHaveAttribute("data-value", "best");
    expect(profile).toHaveTextContent("Лучшее качество");
    expect(screen.queryByText("Для этого видео нет подходящего потока. Выберите другой профиль.")).not.toBeInTheDocument();
  });

  it("collapses and expands the additional video settings", async () => {
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");

    const advancedToggle = screen.getByRole("button", { name: /дополнительно/i });
    expect(advancedToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Разрешение")).not.toBeInTheDocument();

    await userEvent.click(advancedToggle);
    expect(advancedToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Разрешение")).toBeVisible();

    await userEvent.click(advancedToggle);
    expect(screen.queryByLabelText("Разрешение")).not.toBeInTheDocument();
  });

  it("keeps the summary and submitted format aligned with detailed video filters", async () => {
    vi.mocked(api.getSettings).mockResolvedValueOnce({
      concurrency: 2,
      fragmentConcurrency: 1,
      downloadRetries: 10,
      fileAccessRetries: 3,
      fragmentRetries: 10,
      customUserAgentEnabled: false,
      customUserAgent: "",
      includeVideoTechnicalDetailsInFilename: true,
      filenameTemplate: "title",
      filenameCollisionPolicy: "rename",
      playlistFormatSelectionMode: "strict",
      preventSystemSleepWhileDownloading: false,
      minimizeToTray: true,
      completionSoundEnabled: false,
      showThumbnails: true,
      accentColor: "blue",
      proxyMode: "system",
      proxyHost: "",
      proxyPort: 0,
      proxyUsername: "",
      proxyPasswordSet: false,
    });
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Filter Logic Video",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        { formatId: "h264-1080", qualityLabel: "1080p 30fps MP4 H.264 ~95 МБ", kind: "video" as const, ext: "mp4", codec: "avc1.640028", height: 1080, fps: 30, filesize: 100_000_000 },
        { formatId: "av1-1080", qualityLabel: "1080p 60fps MP4 AV1 ~153 МБ", kind: "video" as const, ext: "mp4", codec: "av01.0.08M.08", height: 1080, fps: 60, filesize: 160_000_000 },
        { formatId: "vp9-360", qualityLabel: "360p 30fps WebM VP9 ~52 МБ", kind: "video" as const, ext: "webm", codec: "vp9", height: 360, fps: 30, filesize: 52_000_000 },
      ],
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=filters");
    await screen.findByText("Filter Logic Video");
    await openVideoAdvancedSettings();

    await selectParameter("Кодек", "H.264");
    expect(screen.getByRole("region", { name: "Итоговая загрузка" })).toHaveTextContent("MP4 (H.264)");
    await selectParameter("Разрешение", "360");
    await selectParameter("Кодек", "VP9");

    const summary = screen.getByRole("region", { name: "Итоговая загрузка" });
    expect(summary).toHaveTextContent("WEBM (VP9)");
    expect(summary).toHaveTextContent("360p");
    expect(summary).toHaveTextContent("30fps");
    await userEvent.click(screen.getByRole("button", { name: /скачать видео/i }));
    expect(api.enqueueDownload).toHaveBeenLastCalledWith(expect.objectContaining({
      canonicalSource: "https://youtube.com/watch?v=filters",
      formatId: "vp9-360",
      formatLabel: "360p 30fps WebM VP9 ~52 МБ",
      includeVideoTechnicalDetailsInFilename: true,
      videoTechnicalDetails: {
        height: 360,
        fps: 30,
        codec: "VP9",
        dynamicRange: null,
        requestedContainer: "webm",
      },
    }));
  });

  it("shows a localized duplicate error without clearing the analyzed URL", async () => {
    vi.mocked(api.enqueueDownload).mockRejectedValueOnce("enqueue-error:duplicate-video");
    render(<App />);

    const urlInput = screen.getByLabelText(/ссылка на видео/i);
    await userEvent.type(urlInput, "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");
    await userEvent.click(screen.getByRole("button", { name: /скачать видео/i }));

    const duplicateError = await screen.findByText("Видео с этими параметрами уже находится в Очереди загрузок");
    expect(within(screen.getByRole("region", { name: "Итоговая загрузка" })).getByRole("alert")).toBe(duplicateError);
    expect(urlInput).toHaveValue("https://youtube.com/watch?v=x");
    expect(api.enqueueDownload).toHaveBeenCalledTimes(1);

    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, "https://youtube.com/watch?v=another");

    await waitFor(() => expect(screen.queryByText("Видео с этими параметрами уже находится в Очереди загрузок")).not.toBeInTheDocument());
  });

  it("clears the duplicate error after selecting a different video format", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Profile duplicate",
      uploader: "Channel",
      duration: 120,
      webpageUrl: "https://youtube.com/watch?v=profile-duplicate",
      videoFormats: [
        { formatId: "v1080", qualityLabel: "1080p 30fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.4d401f", height: 1080, fps: 30 },
        { formatId: "v720", qualityLabel: "720p 30fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.4d401e", height: 720, fps: 30 },
      ],
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
    });
    vi.mocked(api.enqueueDownload).mockRejectedValueOnce("enqueue-error:duplicate-video");
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=profile-duplicate");
    await screen.findByText("Profile duplicate");
    await selectParameter("Профиль скачивания", "mp4-1080");
    await userEvent.click(screen.getByRole("button", { name: /скачать видео/i }));
    expect(await screen.findByText("Видео с этими параметрами уже находится в Очереди загрузок")).toBeInTheDocument();

    await selectParameter("Профиль скачивания", "mp4-720");

    expect(screen.queryByText("Видео с этими параметрами уже находится в Очереди загрузок")).not.toBeInTheDocument();
  });

  it("shows an audio duplicate below Download and clears it after changing audio parameters", async () => {
    vi.mocked(api.enqueueDownload).mockRejectedValueOnce("enqueue-error:duplicate-audio");
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");
    await userEvent.click(screen.getByRole("tab", { name: "Аудио" }));
    await userEvent.click(screen.getByRole("button", { name: /скачать аудио/i }));

    const error = await screen.findByText("Аудио с этими параметрами уже находится в Очереди загрузок");
    expect(within(screen.getByRole("region", { name: "Итоговая загрузка" })).getByRole("alert")).toBe(error);

    await selectParameter("Битрейт", "192K");

    expect(screen.queryByText("Аудио с этими параметрами уже находится в Очереди загрузок")).not.toBeInTheDocument();
  });

  it("shows a subtitle duplicate below Download and clears it after changing subtitle parameters", async () => {
    vi.mocked(api.enqueueDownload).mockRejectedValueOnce("enqueue-error:duplicate-subtitles");
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");
    await userEvent.click(screen.getByRole("tab", { name: "Субтитры" }));
    await userEvent.click(screen.getByRole("button", { name: /скачать субтитры/i }));

    const error = await screen.findByText("Субтитры с этими параметрами уже находятся в Очереди загрузок");
    expect(within(screen.getByRole("region", { name: "Итоговая загрузка" })).getByRole("alert")).toBe(error);

    await selectParameter("Формат субтитров", "vtt");

    expect(screen.queryByText("Субтитры с этими параметрами уже находятся в Очереди загрузок")).not.toBeInTheDocument();
  });

  it("disables incompatible codecs instead of resetting the selected resolution", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "4K Compatibility",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        { formatId: "h264-1080", qualityLabel: "1080p 60fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.64002a", height: 1080, fps: 60 },
        { formatId: "vp9-1440", qualityLabel: "1440p 60fps WebM VP9", kind: "video" as const, ext: "webm", codec: "vp9", height: 1440, fps: 60 },
        { formatId: "av1-1440", qualityLabel: "1440p 60fps MP4 AV1 HDR", kind: "video" as const, ext: "mp4", codec: "av01.0.12M.10", height: 1440, fps: 60 },
      ],
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=4k");
    await screen.findByText("4K Compatibility");
    await openVideoAdvancedSettings();
    await selectParameter("Разрешение", "1440");

    expect(optionByValue(await openParameterMenu("Кодек"), "H.264")).toBeDisabled();
    expect(screen.getByLabelText("Разрешение")).toHaveAttribute("data-value", "1440");
    await selectParameter("Кодек", "VP9");
    const summary = screen.getByRole("region", { name: "Итоговая загрузка" });
    expect(summary).toHaveTextContent("WEBM (VP9)");
    expect(summary).toHaveTextContent("1440p");
    expect(summary).toHaveTextContent("60fps");
  });

  it("shows video, audio and subtitle download modes as selectable cards", async () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: /^Видео/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^Аудио/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /^Субтитры/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText(/только извлечь аудио/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Аудио/ }));

    expect(screen.getByText("Настройки аудио")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /^Субтитры/ }));
    expect(screen.getByText(/нет доступных субтитров/i)).toBeInTheDocument();
  });

  it("downloads only the selected subtitle track and format", async () => {
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");
    await userEvent.click(screen.getByRole("tab", { name: /^Субтитры/ }));
    await selectParameter("Язык субтитров", "auto:en");
    await userEvent.click(screen.getByRole("button", { name: /скачать субтитры/i }));

    expect(api.enqueueDownload).toHaveBeenLastCalledWith(expect.objectContaining({
      preset: "subtitles",
      formatId: "en",
      formatLabel: "English (en) • VTT • автоматически",
      subtitle: { language: "en", format: "vtt", automatic: true },
      audioBitrate: null,
      audioChannels: null,
    }));
  });

  it("keeps subtitle mode available but disables download when subtitles are absent", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Video Without Subtitles",
      uploader: "Channel",
      duration: 120,
      videoFormats: [{ formatId: "137", qualityLabel: "1080p", kind: "video" as const }],
      audioFormats: [{ formatId: "140", qualityLabel: "128kbps", kind: "audio" as const }],
      subtitles: [],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=none");
    await screen.findByText("Video Without Subtitles");
    await userEvent.click(screen.getByRole("tab", { name: /^Субтитры/ }));

    expect(screen.getByText(/нет доступных субтитров/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /скачать субтитры/i })).toBeDisabled();
  });

  it("pastes a YouTube URL from the clipboard", async () => {
    vi.mocked(readText).mockResolvedValue("https://youtube.com/watch?v=clipboard");
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /вставить ссылку из буфера обмена/i }));

    expect(readText).toHaveBeenCalled();
    expect(screen.getByLabelText(/ссылка на видео/i)).toHaveValue(
      "https://youtube.com/watch?v=clipboard",
    );
  });

  it("localizes an unavailable clipboard text error in Russian", async () => {
    vi.mocked(readText).mockRejectedValue(
      "The clipboard contents were not available in the requested format or the clipboard is empty.",
    );
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /вставить ссылку/i }));

    expect(await screen.findByText("В буфере обмена нет текстовой ссылки. Скопируйте ссылку и повторите попытку.")).toBeInTheDocument();
    expect(screen.queryByText(/clipboard contents were not available/i)).not.toBeInTheDocument();
  });

  it("localizes an unavailable clipboard text error in English", async () => {
    window.localStorage.setItem(localeStorageKey, "en");
    vi.mocked(readText).mockResolvedValue("");
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /paste link from clipboard/i }));

    expect(await screen.findByText("The clipboard does not contain a text URL. Copy a URL and try again.")).toBeInTheDocument();
  });

  it("always shows cancel all but disables it without cancellable jobs", async () => {
    render(<App />);
    await openQueueSection();

    await screen.findByText("Заданий пока нет");

    const cancelAll = screen.getByRole("button", { name: /отменить все/i });
    const clearQueue = screen.getByRole("button", { name: /очистить очередь/i });
    const cancelAllTooltip = document.getElementById(cancelAll.getAttribute("aria-describedby")!);
    const clearQueueTooltip = document.getElementById(clearQueue.getAttribute("aria-describedby")!);

    expect(cancelAll).toBeDisabled();
    expect(clearQueue).toBeDisabled();
    expect(cancelAllTooltip).toHaveTextContent(
      "Окончательно отменяет все ожидающие, загружающиеся и приостановленные задания.",
    );
    expect(cancelAllTooltip).not.toHaveTextContent("Для отмены одного задания");
    expect(clearQueueTooltip).toHaveTextContent(
      "Удаляет из очереди только неудачные и отменённые объекты. Активные загрузки не затрагиваются.",
    );
  });

  it("keeps cancel all disabled for a single cancellable job", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 1,
        state: "Running",
        request: {
          url: "https://youtube.com/watch?v=single",
          title: "Single Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);
    render(<App />);
    await openQueueSection();

    await screen.findByText("Single Video");

    expect(screen.getByRole("button", { name: /отменить все/i })).toBeDisabled();
  });

  it("does not use a wait cursor for disabled buttons", async () => {
    render(<App />);
    await openQueueSection();

    await screen.findByText("Заданий пока нет");

    expect(getComputedStyle(screen.getByRole("button", { name: /очистить очередь/i })).cursor).toBe(
      "default",
    );
  });

  it("keeps queue bulk action buttons in a horizontal row", async () => {
    render(<App />);
    await openQueueSection();

    await screen.findByText("Заданий пока нет");
    const queueActions = document.querySelector(".queue-actions");

    expect(queueActions).not.toBeNull();
    expect(queueActions).toHaveClass("queue-actions-horizontal");
    expect(document.querySelector(".queue-heading-title")).not.toBeNull();
  });

  it("uses compact Russian detailed quality controls", async () => {
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");

    await screen.findByText("Example Video");
    await openVideoAdvancedSettings();
    expect(screen.getByLabelText("Разрешение")).toBeInTheDocument();
    expect(screen.getByLabelText("FPS")).toBeInTheDocument();
    expect(screen.getByLabelText("Контейнер")).toBeInTheDocument();
    expect(screen.getByLabelText("Кодек")).toBeInTheDocument();
    expect(screen.queryByText(/Video qualities/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Audio qualities/i)).not.toBeInTheDocument();
  });

  it("shows the named video profile chooser instead of quick presets", async () => {
    render(<App />);

    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");
    const profile = screen.getByRole("combobox", { name: "Профиль скачивания" });
    await userEvent.click(profile);
    expect(screen.getByRole("listbox", { name: "Профиль скачивания" })).toBeInTheDocument();
    expect(screen.getByText("По качеству")).toBeInTheDocument();
    expect(screen.queryByLabelText("Справка о быстром выборе")).not.toBeInTheDocument();
  });

  it("submits the current phone profile identifier accepted by the backend", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Phone Profile Video",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        {
          formatId: "v720",
          qualityLabel: "720p 30fps MP4 H.264",
          kind: "video",
          ext: "mp4",
          codec: "avc1.4d401f",
          height: 720,
          fps: 30,
        },
      ],
      audioFormats: [
        {
          formatId: "a1",
          qualityLabel: "128kbps M4A AAC",
          kind: "audio",
          ext: "m4a",
          codec: "mp4a.40.2",
        },
      ],
    });
    render(<App />);

    await userEvent.type(
      screen.getByLabelText(/ссылка на видео/i),
      "https://youtube.com/watch?v=phone-profile",
    );
    await screen.findByText("Phone Profile Video");
    await selectParameter("Профиль скачивания", "phone");
    await userEvent.click(screen.getByRole("button", { name: /скачать видео/i }));

    expect(api.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        videoProfile: "phone",
        formatId: "v720",
        audioFormatId: "a1",
      }),
    );
  });

  it("shows detailed video choices without a long duplicate quality list", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Many Formats",
      uploader: "Channel",
      duration: 120,
      videoFormats: Array.from({ length: 7 }, (_, index) => ({
        formatId: `v${index}`,
        qualityLabel: `${index + 1}080p mp4`,
        kind: "video" as const,
      })),
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" }],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Many Formats");
    await openVideoAdvancedSettings();

    expect(screen.queryByRole("listbox", { name: /качество видео/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Разрешение")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Итоговая загрузка" })).toBeInTheDocument();
  });

  it("filters video quality variants by container codec and frame rate", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Detailed Formats",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        {
          formatId: "h264",
          qualityLabel: "1080p 30fps MP4 H.264 ~95 МБ",
          kind: "video" as const,
          ext: "mp4",
          codec: "avc1.640028",
          height: 1080,
          fps: 30,
          filesize: 100000000,
        },
        {
          formatId: "vp9",
          qualityLabel: "1080p 30fps WebM VP9 ~86 МБ",
          kind: "video" as const,
          ext: "webm",
          codec: "vp9",
          height: 1080,
          fps: 30,
          filesize: 90000000,
        },
        {
          formatId: "av1-hdr",
          qualityLabel: "1080p 60fps MP4 AV1 HDR ~153 МБ",
          kind: "video" as const,
          ext: "mp4",
          codec: "av01.0.08M.08",
          height: 1080,
          fps: 60,
          dynamicRange: "HDR",
          filesize: 160000000,
        },
      ],
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps M4A AAC ~4 МБ", kind: "audio" as const }],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Detailed Formats");
    await openVideoAdvancedSettings();

    expect(screen.getByRole("region", { name: "Итоговая загрузка" })).toHaveTextContent("MP4 (AV1 + AAC)");

    await selectParameter("Контейнер", "webm");

    const summary = screen.getByRole("region", { name: "Итоговая загрузка" });
    expect(summary).toHaveTextContent("WEBM (VP9)");
    expect(summary).toHaveTextContent("30fps");
    expect(summary).not.toHaveTextContent("MP4 (AV1)");
  });

  it("offers an auto reset option in each detailed video select", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Auto Reset Formats",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        {
          formatId: "h264-1080",
          qualityLabel: "1080p 30fps MP4 H.264 ~95 РњР‘",
          kind: "video" as const,
          ext: "mp4",
          codec: "avc1.640028",
          height: 1080,
          fps: 30,
          filesize: 100000000,
        },
        {
          formatId: "av1-1080",
          qualityLabel: "1080p 60fps MP4 AV1 ~153 РњР‘",
          kind: "video" as const,
          ext: "mp4",
          codec: "av01.0.08M.08",
          height: 1080,
          fps: 60,
          filesize: 160000000,
        },
        {
          formatId: "vp9-720",
          qualityLabel: "720p 30fps WebM VP9 ~86 РњР‘",
          kind: "video" as const,
          ext: "webm",
          codec: "vp9",
          height: 720,
          fps: 30,
          filesize: 90000000,
        },
      ],
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps M4A AAC ~4 РњР‘", kind: "audio" as const }],
    });
    render(<App />);

    await userEvent.type(
      screen.getByLabelText(
        /\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 \u0432\u0438\u0434\u0435\u043e/i,
      ),
      "https://youtube.com/watch?v=x",
    );
    await screen.findByText("Auto Reset Formats");
    await openVideoAdvancedSettings();

    const resolutionSelect = screen.getByLabelText(
      "\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0438\u0435",
    );
    const fpsSelect = screen.getByLabelText("FPS");
    const containerSelect = screen.getByLabelText(
      "\u041a\u043e\u043d\u0442\u0435\u0439\u043d\u0435\u0440",
    );
    const codecSelect = screen.getByLabelText("\u041a\u043e\u0434\u0435\u043a");

    for (const select of [resolutionSelect, fpsSelect, containerSelect, codecSelect]) {
      const autoOption = optionByValue(await openParameterMenu(select.getAttribute("aria-label")!), "all");
      expect(autoOption).not.toBeNull();
      expect(autoOption).toHaveAttribute("data-value", "all");
      expect(autoOption).toHaveTextContent("\u0410\u0432\u0442\u043e");
    }

    await selectParameter("\u041a\u043e\u043d\u0442\u0435\u0439\u043d\u0435\u0440", "webm");
    expect(containerSelect).toHaveAttribute("data-value", "webm");

    await selectParameter("\u041a\u043e\u043d\u0442\u0435\u0439\u043d\u0435\u0440", "all");
    expect(containerSelect).toHaveAttribute("data-value", "all");
    expect(screen.getByRole("combobox", { name: "Профиль скачивания" })).toHaveAttribute("data-value", "best");
    expect(screen.getByRole("region", { name: "Итоговая загрузка" })).toHaveTextContent("MP4 (AV1 + AAC)");
  });

  it("selects the best video and audio qualities after analysis", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Sorted by UI",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        { formatId: "v720", qualityLabel: "720p 30fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.4d401f", height: 720, fps: 30 },
        { formatId: "v1080", qualityLabel: "1080p 60fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.64002a", height: 1080, fps: 60 },
      ],
      audioFormats: [
        { formatId: "a128", qualityLabel: "128kbps M4A AAC", kind: "audio" as const, ext: "m4a", codec: "mp4a.40.2", filesize: 10_000_000 },
        { formatId: "a256", qualityLabel: "256kbps M4A AAC", kind: "audio" as const, ext: "m4a", codec: "mp4a.40.2", filesize: 20_000_000 },
      ],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Sorted by UI");
    const summary = screen.getByRole("region", { name: "Итоговая загрузка" });
    expect(summary).toHaveTextContent("MP4 (H.264 + AAC)");
    expect(summary).toHaveTextContent("1080p");
    expect(summary).toHaveTextContent("60fps");
    await userEvent.click(screen.getByRole("button", { name: /скачать/i }));

    expect(api.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        formatId: "v1080",
        audioFormatId: "a256",
        formatLabel: "1080p 60fps MP4 H.264 + AAC",
      }),
    );
  });

  it("shows MKV for best-quality MP4 video combined with Opus audio", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Mixed best streams",
      videoFormats: [
        { formatId: "137", qualityLabel: "988p 24fps MP4 H.264", kind: "video", ext: "mp4", codec: "avc1.640028", height: 988, fps: 24, filesize: 69_000_000 },
      ],
      audioFormats: [
        { formatId: "251", qualityLabel: "160kbps WebM Opus", kind: "audio", ext: "webm", codec: "opus", filesize: 4_000_000 },
      ],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=mixed");
    await screen.findByText("Mixed best streams");

    expect(screen.getByRole("region", { name: "Итоговая загрузка" })).toHaveTextContent("MKV (H.264 + Opus)");
    await userEvent.click(screen.getByRole("button", { name: /скачать/i }));
    expect(api.enqueueDownload).toHaveBeenCalledWith(expect.objectContaining({
      formatId: "137",
      audioFormatId: "251",
      formatLabel: "988p 24fps MKV H.264 + Opus",
    }));
  });

  it("shows a readable browser cookies error", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "ERROR: could not find chrome cookies database in C:\\Users\\TestUser\\AppData",
    );
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await userEvent.click(screen.getByRole("button", { name: "Новая загрузка" }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");

    expect(await screen.findByText(/Не удалось найти cookies Chrome/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not find chrome cookies database/i)).not.toBeInTheDocument();
  });

  it("shows a readable error when URL analysis exceeds sixty seconds", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce("analysis-error:timeout");
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=timeout");

    expect(await screen.findByText(/не удалось проанализировать ссылку\. проверьте подключение/i)).toBeInTheDocument();
    expect(screen.getByText(/VPN или системный прокси/i)).toBeInTheDocument();
  });

  it("shows a readable DPAPI error for Chromium cookies", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "ERROR: Failed to decrypt with DPAPI. See https://github.com/yt-dlp/yt-dlp/issues/10927 for more info",
    );
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await selectParameter(/браузер для входа/i, "brave");
    await userEvent.click(screen.getByRole("button", { name: "Новая загрузка" }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");

    expect(await screen.findByText("Не удалось расшифровать cookies выбранного Chromium-браузера через защиту Windows (DPAPI). Некоторые Chromium-браузеры дополнительно защищают cookies, и программа не может их прочитать. Это не ошибка YTLoadster. Используйте Firefox/LibreWolf для авторизации или используйте \"Войти в YouTube\".")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to decrypt with DPAPI/i)).not.toBeInTheDocument();
  });

  it("shows a readable error when Chromium cookies are locked", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info",
    );
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await selectParameter(/браузер для входа/i, "vivaldi");
    await userEvent.click(screen.getByRole("button", { name: "Новая загрузка" }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");

    expect(await screen.findByText("Не удалось получить доступ к cookies выбранного браузера. Закройте ваш браузер и повторите попытку. Если ошибка останется, используйте другой браузер для входа (например, Firefox).")).toBeInTheDocument();
    expect(screen.queryByText(/Could not copy Chrome cookie database/i)).not.toBeInTheDocument();
  });

  it("does not suggest changing Firefox for a locked cookies database", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info",
    );
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await selectParameter(/браузер для входа/i, "firefox");
    await userEvent.click(screen.getByRole("button", { name: "Новая загрузка" }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");

    expect(await screen.findByText("Не удалось получить доступ к cookies выбранного браузера. Закройте ваш браузер и повторите попытку.")).toBeInTheDocument();
    expect(screen.queryByText(/используйте другой браузер для входа/i)).not.toBeInTheDocument();
  });

  it("hides the internal download component name in unknown errors", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce("ERROR: yt-dlp failed unexpectedly");
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");

    expect(await screen.findByText("ERROR: программа failed unexpectedly")).toBeInTheDocument();
    expect(screen.queryByText(/yt-dlp/i)).not.toBeInTheDocument();
  });

  it("shows a readable 429 error without internal links or runtime warnings", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "WARNING: [youtube] No supported JavaScript runtime could be found. See https://github.com/yt-dlp/yt-dlp/wiki/EJS for details ERROR: Unable to download video subtitles for 'ab': HTTP Error 429: Too Many Requests",
    );
    render(<App />);

    await userEvent.type(
      screen.getByLabelText(/ссылка на видео/i),
      "https://youtube.com/watch?v=x",
    );

    expect(
      await screen.findByText(
        "YouTube временно ограничил количество запросов (ошибка 429). Подождите некоторое время и повторите попытку. Если ошибка возникла при загрузке субтитров, попробуйте выбрать другую дорожку или уменьшить количество одновременных загрузок.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/github\.com|JavaScript runtime|yt-dlp/i)).not.toBeInTheDocument();
  });

  it("explains that an age-restricted video requires YouTube sign-in", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "ERROR: [youtube] aZL8z5PDDWI: Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ for tips",
    );
    render(<App />);

    await userEvent.type(
      screen.getByLabelText(/ссылка на видео/i),
      "https://youtube.com/watch?v=aZL8z5PDDWI",
    );

    expect(
      await screen.findByText(
        "Для этого видео YouTube требует войти в аккаунт и подтвердить возраст. Откройте Настройки → Авторизация → Войти в YouTube, выполните вход и повторите попытку. Если вход уже выполнен, убедитесь, что возраст подтверждён в аккаунте.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cookies-from-browser|github\.com|yt-dlp/i)).not.toBeInTheDocument();
  });

  it("explains YouTube bot-confirmation errors without technical instructions", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "ERROR: [youtube] pe9e-3BME64: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ for tips",
    );
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=pe9e-3BME64");

    expect(await screen.findByText("YouTube просит подтвердить, что вы не робот. Откройте Настройки → Авторизация → Войти в YouTube, выполните вход и повторите попытку.")).toBeInTheDocument();
    expect(screen.queryByText(/cookies-from-browser|github\.com|yt-dlp/i)).not.toBeInTheDocument();
  });

  it("offers Windows browser choices without Edge or Safari", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    const browserSelect = screen.getByLabelText(/браузер для входа/i);
    const browserMenu = await openParameterMenu(/браузер для входа/i);

    for (const browser of ["Chrome", "Firefox", "LibreWolf", "Brave", "Vivaldi", "Opera"]) {
      expect(within(browserMenu).getByRole("option", { name: browser })).toBeInTheDocument();
    }
    expect(within(browserMenu).queryByRole("option", { name: /Safari/i })).not.toBeInTheDocument();
    expect(within(browserMenu).queryByRole("option", { name: "Edge" })).not.toBeInTheDocument();
    expect(browserSelect).toHaveAttribute("data-value", "chrome");
  });

  it("opens the browser list only from its select control", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    const browserSelect = screen.getByLabelText(/браузер для входа/i);
    const browserField = browserSelect.closest<HTMLElement>(".settings-field");

    expect(browserField).not.toBeNull();
    await userEvent.click(within(browserField!).getByText("Браузер для входа"));
    expect(screen.queryByRole("listbox", { name: /браузер для входа/i })).not.toBeInTheDocument();

    await userEvent.click(browserSelect);
    expect(screen.getByRole("listbox", { name: /браузер для входа/i })).toBeInTheDocument();
  });

  it("presents browser cookies as the primary sign-in method and YouTube sign-in as fallback", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));

    expect(screen.getByText("Выберите браузер, в котором уже выполнен вход в YouTube. Обычно этого достаточно для возрастных и аккаунтных видео.")).toBeInTheDocument();
    expect(screen.getByText("Не удалось использовать вход из браузера?")).toBeInTheDocument();
    expect(screen.queryByLabelText(/браузер для входа/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    expect(screen.getByLabelText(/браузер для входа/i)).toBeInTheDocument();
  });

  it("offers Safari only when the backend reports macOS", async () => {
    vi.mocked(api.getAppStatus).mockResolvedValueOnce({
      name: "YTLoadster",
      ready: true,
      platform: "macos",
    });
    render(<App />);

    await waitFor(() => expect(api.getAppStatus).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    const browserMenu = await openParameterMenu(/браузер для входа/i);

    expect(within(browserMenu).getByRole("option", { name: "Safari" })).toBeEnabled();
  });

  it("keeps download disabled until the current URL is analyzed", async () => {
    render(<App />);

    const downloadButton = await screen.findByRole("button", { name: /скачать/i });
    expect(downloadButton).toBeDisabled();
    expect(downloadButton).toHaveAttribute("data-analyzed", "false");

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    expect(downloadButton).toBeDisabled();

    await screen.findByText("Example Video");
    expect(downloadButton).toBeEnabled();
    expect(downloadButton).toHaveAttribute("data-analyzed", "true");

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "2");
    expect(downloadButton).toBeDisabled();
    expect(downloadButton).toHaveAttribute("data-analyzed", "false");
  });

  it("shows a readable error for an invalid pasted URL", async () => {
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "not a youtube link");

    expect(await screen.findByText("Введите корректную ссылку YouTube.")).toBeInTheDocument();
    expect(api.probeUrl).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /скачать/i })).toBeDisabled();
  });

  it("does not show or request developer tool status on the main screen", async () => {
    render(<App />);

    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");
    expect(screen.queryByLabelText(/статус инструментов/i)).not.toBeInTheDocument();
    expect(api.getToolStatus).not.toHaveBeenCalled();
  });

  it("uses a compact header without the Windows label", async () => {
    render(<App />);

    await screen.findByText("YTLoadster");

    const headerLogo = document.querySelector<HTMLImageElement>(".brand-mark");
    expect(headerLogo).not.toBeNull();
    expect(headerLogo?.src).toContain("app-icon");
    expect(screen.queryByText(/Windows/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^v?0\.1(?:\.0)?$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/скачивание видео и аудио/i)).toBeInTheDocument();
  });

  it("keeps browser sign-in inside the settings menu", async () => {
    render(<App />);

    expect(screen.queryByLabelText(/использовать вход из браузера/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));

    expect(screen.getByRole("region", { name: /настройки/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /авторизация/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/использовать вход из браузера/i)).toBeInTheDocument();
  });

  it("explains the separate YouTube sign-in and keeps it available on Windows", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));

    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    const helpIcon = screen.getByRole("img", {
      name: /вход нужен для видео с возрастными/i,
    });
    await waitFor(() => expect(loginButton).toBeEnabled());
    expect(helpIcon).toHaveAttribute("data-tooltip", expect.stringMatching(/не считывает пароль.+cookies YouTube/i));
    expect(screen.queryByRole("button", { name: /встроенный вход \(тест\)/i })).not.toBeInTheDocument();
    expect(document.querySelector(".youtube-auth-webview-button")).toHaveAttribute("hidden");
  });

  it("shows the browser sign-in instructions before opening the browser", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);

    const warning = screen.getByRole("alertdialog", { name: /перед входом в YouTube/i });
    expect(within(warning).getByText(/выберите нужный аккаунт, если их несколько/i)).toBeInTheDocument();
    expect(within(warning).getByText(/дождитесь.+откроется YouTube/i)).toBeInTheDocument();
    expect(within(warning).getByText(/сессия сохранится автоматически.+окно можно оставить открытым/i)).toBeInTheDocument();
    expect(api.startYoutubeAuth).not.toHaveBeenCalled();

    await userEvent.click(within(warning).getByRole("button", { name: /понятно, продолжить/i }));
    expect(api.startYoutubeAuth).toHaveBeenCalledTimes(1);
  });

  it("starts the same browser sign-in flow in the macOS interface", async () => {
    window.localStorage.setItem(localeStorageKey, "en");
    vi.mocked(api.getAppStatus).mockResolvedValueOnce({
      name: "YTLoadster",
      ready: true,
      platform: "macos",
    });
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    await userEvent.click(screen.getByRole("tab", { name: /authorization/i }));
    const loginButton = screen.getByRole("button", { name: /sign in to YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);

    const warning = screen.getByRole("alertdialog", { name: /before signing in to YouTube/i });
    expect(within(warning).getByText(/select the account.+if more than one is available/i)).toBeInTheDocument();
    expect(within(warning).getByText(/wait until YouTube opens/i)).toBeInTheDocument();
    expect(within(warning).getByText(/session will be saved automatically.+leave the window open/i)).toBeInTheDocument();
    await userEvent.click(within(warning).getByRole("button", { name: "Continue" }));

    expect(api.startYoutubeAuth).toHaveBeenCalledWith("chrome");
  });

  it("uses the dark-theme surface for the browser sign-in warning", async () => {
    window.localStorage.setItem(themeStorageKey, "dark");
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);

    const warning = screen.getByRole("alertdialog", { name: /перед входом в YouTube/i });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(warning).toHaveClass("youtube-auth-warning-dialog");
    expect(warning.parentElement).toHaveClass("youtube-auth-warning-backdrop");
  });

  it("completes the experimental WebView2 sign-in automatically", async () => {
    vi.mocked(api.getYoutubeAuthStatus)
      .mockResolvedValueOnce({ supported: true, authenticated: false, browser: null })
      .mockResolvedValueOnce({ supported: true, authenticated: true, browser: "WebView2" });
    vi.mocked(api.getYoutubeWebviewAuthState).mockResolvedValueOnce({
      open: false,
      authenticated: true,
    });
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const webviewButton = document.querySelector<HTMLButtonElement>(".youtube-auth-webview-button");
    expect(webviewButton).not.toBeNull();
    expect(webviewButton).toHaveAttribute("hidden");
    await waitFor(() => expect(webviewButton).toBeEnabled());
    act(() => webviewButton!.click());

    expect(await screen.findByText(/завершите вход во встроенном окне/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/вход выполнен через WebView2/i, {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(api.startYoutubeWebviewAuth).toHaveBeenCalledTimes(1);
    expect(api.getYoutubeWebviewAuthState).toHaveBeenCalled();
  });

  it.each(["windows", "macos"])("reenables YouTube sign-in when the %s browser closes before authentication", async (platform) => {
    vi.mocked(api.getAppStatus).mockResolvedValueOnce({ name: "YTLoadster", ready: true, platform });
    vi.mocked(api.getYoutubeAuthWindowState).mockResolvedValueOnce({
      open: false, sessionDetected: false,
      status: { supported: true, authenticated: false, browser: null },
    });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    await userEvent.click(screen.getByRole("button", { name: /понятно, продолжить/i }));

    expect(await screen.findByText(/окно браузера закрыто.+можно повторить/i)).toBeInTheDocument();
    expect(loginButton).toBeEnabled();
    expect(window.localStorage.getItem("ytloadster.browserAuth") ?? "").not.toContain('"useYoutubeSession":true');
  });

  it.each([
    { platform: "windows", locale: "ru", theme: "light" },
    { platform: "macos", locale: "en", theme: "dark" },
  ])("activates the saved $platform YouTube session in $locale while the browser stays open", async ({ platform, locale, theme }) => {
    window.localStorage.setItem(localeStorageKey, locale);
    window.localStorage.setItem(themeStorageKey, theme);
    vi.mocked(api.getAppStatus).mockResolvedValueOnce({ name: "YTLoadster", ready: true, platform });
    const status = { supported: true, authenticated: true, browser: "Google Chrome" };
    vi.mocked(api.startYoutubeAuth).mockResolvedValueOnce({ browser: "Google Chrome" });
    vi.mocked(api.getYoutubeAuthWindowState).mockResolvedValue({ open: true, sessionDetected: true, status });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /settings|настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /authorization|авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /sign in to YouTube|войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/leave the window open|окно можно оставить открытым/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Continue|понятно, продолжить/i }));

    expect(await screen.findByText(/signed in through Google Chrome|вход выполнен через Google Chrome/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out of YouTube|выйти из YouTube/i })).toBeEnabled();
    expect(window.localStorage.getItem("ytloadster.browserAuth")).toContain('"useYoutubeSession":true');
    expect(api.cancelYoutubeAuth).not.toHaveBeenCalled();
    expect(document.documentElement).toHaveAttribute("data-theme", theme);
    // The next probe can use the session before any closed-window response.
    await userEvent.click(screen.getByRole("button", { name: /new download|новая загрузка/i }));
    fireEvent.change(screen.getByPlaceholderText(/youtube\.com/i), { target: { value: "https://youtube.com/watch?v=authenticated" } });
    await waitFor(() => expect(api.probeUrl).toHaveBeenCalledWith(
      "https://youtube.com/watch?v=authenticated", { kind: "youtubeSession" }, expect.any(String),
    ));
  });

  it("ignores late YouTube startup after the app is unmounted", async () => {
    let finishStart!: (value: { browser: string }) => void;
    vi.mocked(api.startYoutubeAuth).mockImplementationOnce(() => new Promise((resolve) => { finishStart = resolve; }));
    const { unmount } = render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    await userEvent.click(screen.getByRole("button", { name: /понятно, продолжить/i }));
    expect(api.startYoutubeAuth).toHaveBeenCalledTimes(1);
    unmount();
    vi.useFakeTimers();
    await act(async () => finishStart({ browser: "Microsoft Edge" }));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(api.getYoutubeAuthWindowState).not.toHaveBeenCalled();
  });

  it("keeps the saved YouTube session after the separate browser closes", async () => {
    const status = { supported: true, authenticated: true, browser: "Microsoft Edge" };
    vi.mocked(api.getYoutubeAuthWindowState)
      .mockResolvedValueOnce({ open: true, sessionDetected: true, status })
      .mockResolvedValueOnce({ open: false, sessionDetected: true, status });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    await userEvent.click(screen.getByRole("button", { name: /понятно, продолжить/i }));
    expect(await screen.findByText(/вход выполнен через Microsoft Edge/i)).toBeInTheDocument();
    await waitFor(() => expect(api.getYoutubeAuthWindowState).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/вход выполнен через Microsoft Edge/i)).toBeInTheDocument();
    expect(window.localStorage.getItem("ytloadster.browserAuth")).toContain('"useYoutubeSession":true');
  });

  it("activates a session saved in the background before the first window-state poll", async () => {
    vi.mocked(api.getYoutubeAuthWindowState).mockResolvedValueOnce({
      open: false, sessionDetected: true,
      status: { supported: true, authenticated: true, browser: "Microsoft Edge" },
    });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    await userEvent.click(screen.getByRole("button", { name: /понятно, продолжить/i }));
    expect(await screen.findByText(/вход выполнен через Microsoft Edge/i)).toBeInTheDocument();
    expect(window.localStorage.getItem("ytloadster.browserAuth")).toContain('"useYoutubeSession":true');
  });

  it("disables saved-session usage when the user logs out in the open browser", async () => {
    vi.mocked(api.getYoutubeAuthWindowState)
      .mockResolvedValueOnce({ open: true, sessionDetected: true,
        status: { supported: true, authenticated: true, browser: "Microsoft Edge" } })
      .mockResolvedValueOnce({ open: true, sessionDetected: false,
        status: { supported: true, authenticated: false, browser: null } });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    await userEvent.click(screen.getByRole("button", { name: /понятно, продолжить/i }));
    expect(await screen.findByText(/вход выполнен через Microsoft Edge/i)).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem("ytloadster.browserAuth")).toContain('"useYoutubeSession":false'));
    expect(screen.getByText(/сессия сохранится автоматически/i)).toBeInTheDocument();
  });

  it("ignores an in-flight cookie poll after signing out of YTLoadster", async () => {
    const status = { supported: true, authenticated: true, browser: "Microsoft Edge" };
    let finishPoll!: (value: { open: boolean; sessionDetected: boolean; status: typeof status }) => void;
    vi.mocked(api.getYoutubeAuthWindowState)
      .mockResolvedValueOnce({ open: true, sessionDetected: true, status })
      .mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve; }));
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    await userEvent.click(screen.getByRole("button", { name: /понятно, продолжить/i }));
    expect(await screen.findByText(/вход выполнен через Microsoft Edge/i)).toBeInTheDocument();
    await waitFor(() => expect(finishPoll).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: /выйти из YouTube/i }));
    await waitFor(() => expect(api.signOutYoutube).toHaveBeenCalledTimes(1));
    await act(async () => finishPoll({ open: true, sessionDetected: true, status }));
    expect(screen.queryByText(/вход выполнен через Microsoft Edge/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("ytloadster.browserAuth")).toContain('"useYoutubeSession":false');
  });
  it.each([
    { locale: "ru", message: "Не удалось завершить вход в YouTube." },
    { locale: "en", message: "Could not complete YouTube sign-in." },
  ])("localizes a macOS browser connection failure in $locale", async ({ locale, message }) => {
    window.localStorage.setItem(localeStorageKey, locale);
    vi.mocked(api.startYoutubeAuth).mockRejectedValueOnce("youtube-auth-connection-failed");
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /settings|настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /authorization|авторизация/i }));
    const loginButton = screen.getByRole("button", { name: /sign in to YouTube|войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    await userEvent.click(screen.getByRole("button", { name: /Continue|понятно, продолжить/i }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText("youtube-auth-connection-failed")).not.toBeInTheDocument();
  });

  it("clears saved YouTube sign-in data even when no session is active", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const clearButton = screen.getByRole("button", { name: /очистить данные входа/i });
    await waitFor(() => expect(clearButton).toBeEnabled());
    await userEvent.click(clearButton);

    expect(api.clearYoutubeAuth).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/данные входа и cookies.+удалены/i)).toBeInTheDocument();
  });

  it("uses one complete sign-out action for an authenticated YouTube session", async () => {
    vi.mocked(api.getYoutubeAuthStatus).mockResolvedValueOnce({
      supported: true,
      authenticated: true,
      browser: "Microsoft Edge",
    });
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    const logoutButton = await screen.findByRole("button", { name: /выйти из YouTube/i });
    expect(screen.queryByRole("button", { name: /очистить данные входа/i })).not.toBeInTheDocument();
    await userEvent.click(logoutButton);

    expect(api.signOutYoutube).toHaveBeenCalledTimes(1);
  });

  it("shows application details only in the About settings tab", async () => {
    render(<App />);

    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");
    expect(screen.queryByText("0.1.1")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе/i }));

    expect(screen.getByRole("tab", { name: /о программе/i })).toHaveAttribute("aria-selected", "true");
    const aboutPanel = screen.getByRole("tabpanel", { name: /о программе/i });
    expect(aboutPanel).toBeInTheDocument();
    expect(within(aboutPanel).getByRole("heading", { name: "YTLoadster" })).toBeInTheDocument();
    expect(screen.getByText("0.1.2")).toBeInTheDocument();
    expect(screen.getByText(/программа для загрузки видео, аудио и субтитров/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/sailars/YTLoadster");
    expect(await screen.findByText("Установлена актуальная версия.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Проверить обновления" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Свободные компоненты" })).toBeInTheDocument();
    expect(screen.getByText(/исходный код и условия лицензий доступны по ссылкам ниже/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "yt-dlp" })).toHaveAttribute("href", "https://github.com/yt-dlp/yt-dlp");
    expect(screen.getByRole("link", { name: "Deno" })).toHaveAttribute("href", "https://github.com/denoland/deno");
    expect(screen.getByRole("link", { name: "FFmpeg" })).toHaveAttribute("href", "https://ffmpeg.org/");
    expect(screen.queryByRole("link", { name: "Tauri" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "React" })).not.toBeInTheDocument();
    expect(screen.queryByText(/анализ ссылок|обработка и объединение/i)).not.toBeInTheDocument();
    const aboutLogo = document.querySelector<HTMLImageElement>(".about-program-icon");
    const headerLogo = document.querySelector<HTMLImageElement>(".brand-mark");
    expect(aboutLogo?.src).toBe(headerLogo?.src);

    await userEvent.click(screen.getByRole("link", { name: "yt-dlp" }));
    expect(api.openExternalUrl).toHaveBeenCalledWith("https://github.com/yt-dlp/yt-dlp");
    expect(screen.queryByLabelText(/использовать вход из браузера/i)).not.toBeInTheDocument();
  });

  it("notifies about an available update and opens its release page", async () => {
    vi.mocked(api.checkForUpdates).mockResolvedValueOnce({
      currentVersion: "0.1.0",
      latestVersion: "0.1.1",
      updateAvailable: true,
      releaseUrl: "https://github.com/sailars/YTLoadster/releases/latest",
    });

    render(<App />);

    const noticeTitle = await screen.findByText("Доступно обновление");
    const notice = noticeTitle.closest<HTMLElement>(".update-notice");
    expect(notice).not.toBeNull();
    expect(within(notice!).getByText("Вышла версия YTLoadster 0.1.1.")).toBeInTheDocument();

    await userEvent.click(within(notice!).getByRole("button", { name: "Открыть страницу выпуска" }));
    expect(api.openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/sailars/YTLoadster/releases/latest",
    );

    await userEvent.click(within(notice!).getByRole("button", { name: /скрыть уведомление/i }));
    expect(screen.queryByText("Доступно обновление")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе/i }));
    expect(screen.getByText("Доступна новая версия: 0.1.1.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Проверить обновления" }));
    await waitFor(() => expect(api.checkForUpdates).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Установлена актуальная версия.")).toBeInTheDocument();
  });

  it.each([
    { locale: "ru", neutral: "Отдельные обновления пока не опубликованы.", failure: "Сведения об обновлении недоступны." },
    { locale: "en", neutral: "Separate updates have not been published yet.", failure: "Update information is unavailable." },
  ])("distinguishes unpublished component updates from check failures in $locale", async ({ locale, neutral, failure }) => {
    window.localStorage.setItem(localeStorageKey, locale);
    vi.mocked(api.checkComponentUpdates).mockResolvedValueOnce([
      { id: "ffmpeg", currentVersion: "8.1.2", latestVersion: null, state: "notPublished", sourceUrl: null },
      { id: "ytdlp", currentVersion: "2026.08.19", latestVersion: null, state: "unavailable", sourceUrl: null },
    ]);
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки|settings/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе|about/i }));
    await userEvent.click(screen.getByRole("button", { name: /проверить обновления компонентов|check component updates/i }));
    const message = await screen.findByText(neutral);
    expect(screen.getByText(failure)).toBeInTheDocument();
    const row = message.closest("li")!;
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    { locale: "ru", current: "У вас установлена последняя версия.", newer: "Выпущена версия 9.0.2. Обновление через приложение пока недоступно." },
    { locale: "en", current: "You have the latest version installed.", newer: "Version 9.0.2 has been released. In-app update is not available yet." },
  ])("shows verified FFmpeg versions without an installable package in $locale", async ({ locale, current, newer }) => {
    window.localStorage.setItem(localeStorageKey, locale);
    vi.mocked(api.checkComponentUpdates)
      .mockResolvedValueOnce([{ id: "ffmpeg", currentVersion: "9.0.2", latestVersion: "9.0.2", state: "upToDate", sourceUrl: "https://ffmpeg.org/download.html" }])
      .mockResolvedValueOnce([{ id: "ffmpeg", currentVersion: "8.1.2", latestVersion: "9.0.2", state: "newerRelease", sourceUrl: "https://ffmpeg.org/download.html" }]);
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки|settings/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе|about/i }));
    const check = screen.getByRole("button", { name: /проверить обновления компонентов|check component updates/i });
    await userEvent.click(check);
    expect(await screen.findByText(current)).toBeInTheDocument();
    await userEvent.click(check);
    const message = await screen.findByText(newer);
    expect(screen.queryByText(current)).not.toBeInTheDocument();
    expect(within(message.closest("li")!).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the new Deno version after a component update", async () => {
    vi.mocked(api.checkComponentUpdates)
      .mockResolvedValueOnce([
        { id: "ytdlp", currentVersion: "2026.08.19", latestVersion: "2026.08.19", state: "upToDate", sourceUrl: "https://github.com/yt-dlp/yt-dlp/releases" },
        { id: "deno", currentVersion: "2.9.2", latestVersion: "2.9.7", state: "available", sourceUrl: "https://github.com/denoland/deno/releases" },
        { id: "ffmpeg", currentVersion: "8.1.2", latestVersion: null, state: "unavailable", sourceUrl: null },
      ])
      .mockResolvedValueOnce([
        { id: "ytdlp", currentVersion: "2026.08.19", latestVersion: "2026.08.19", state: "upToDate", sourceUrl: "https://github.com/yt-dlp/yt-dlp/releases" },
        { id: "deno", currentVersion: "2.9.7", latestVersion: "2.9.7", state: "upToDate", sourceUrl: "https://github.com/denoland/deno/releases" },
        { id: "ffmpeg", currentVersion: "8.1.2", latestVersion: null, state: "unavailable", sourceUrl: null },
      ]);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе/i }));
    await userEvent.click(screen.getByRole("button", { name: "Проверить обновления компонентов" }));
    expect(await screen.findByText("Установлена версия 2.9.2.")).toBeInTheDocument();
    expect(screen.getByText("Доступна версия 2.9.7.")).toBeInTheDocument();
    expect(screen.getByText("Сведения об обновлении недоступны.")).toBeInTheDocument();
    const denoRow = screen.getByText("Доступна версия 2.9.7.").closest("li");
    expect(denoRow).not.toBeNull();
    await userEvent.click(within(denoRow!).getByRole("link", { name: "Страница выпуска" }));
    expect(api.openExternalUrl).toHaveBeenCalledWith("https://github.com/denoland/deno/releases");
    await userEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(() => expect(api.installComponentUpdate).toHaveBeenCalledWith("deno"));
    expect(await screen.findByText("Установлена версия 2.9.7.")).toBeInTheDocument();
  });

  it("keeps an available component visible after installation fails", async () => {
    vi.mocked(api.checkComponentUpdates).mockResolvedValueOnce([
      { id: "deno", currentVersion: "2.9.2", latestVersion: "2.9.3", state: "available", sourceUrl: "https://github.com/denoland/deno/releases" },
    ]);
    vi.mocked(api.installComponentUpdate).mockRejectedValueOnce(new Error("checksum mismatch"));

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе/i }));
    await userEvent.click(screen.getByRole("button", { name: "Проверить обновления компонентов" }));
    await userEvent.click(await screen.findByRole("button", { name: "Обновить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось установить обновление. Повторите попытку.");
    expect(screen.getByRole("button", { name: "Обновить" })).toBeEnabled();
  });

  it("lets the user disable automatic update checks while keeping manual checks", async () => {
    window.localStorage.setItem(automaticUpdateChecksStorageKey, "false");

    render(<App />);

    expect(api.checkForUpdates).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));

    let automaticCheck = screen.getByRole("switch", {
      name: "Автоматически проверять обновления",
    });
    expect(automaticCheck).not.toBeChecked();

    await userEvent.click(screen.getByRole("tab", { name: /о программе/i }));
    await userEvent.click(screen.getByRole("button", { name: "Проверить обновления" }));
    await waitFor(() => expect(api.checkForUpdates).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("tab", { name: /общие/i }));
    automaticCheck = screen.getByRole("switch", { name: "Автоматически проверять обновления" });
    await userEvent.click(automaticCheck);
    expect(automaticCheck).toBeChecked();
    expect(window.localStorage.getItem(automaticUpdateChecksStorageKey)).toBe("true");
    await waitFor(() => expect(api.checkForUpdates).toHaveBeenCalledTimes(2));

    await userEvent.click(automaticCheck);
    expect(automaticCheck).not.toBeChecked();
    expect(window.localStorage.getItem(automaticUpdateChecksStorageKey)).toBe("false");
  });

  it("shows a readable update-check error in About", async () => {
    vi.mocked(api.checkForUpdates).mockRejectedValueOnce(new Error("network unavailable"));

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе/i }));

    expect(await screen.findByText(/не удалось проверить обновления/i)).toBeInTheDocument();
    expect(screen.queryByText(/network unavailable/i)).not.toBeInTheDocument();
  });

  it("opens settings on General after visiting another section", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе/i }));
    expect(screen.getByRole("tab", { name: /о программе/i })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("button", { name: "Новая загрузка" }));
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));

    expect(screen.getByRole("tab", { name: /общие/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByLabelText(/использовать вход из браузера/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: /о программе/i })).not.toBeInTheDocument();
  });

  it("closes the settings section when Escape is pressed", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    expect(screen.getByRole("region", { name: /^Настройки$/ })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: /^Настройки$/ })).not.toBeInTheDocument();
  });

  it("shows and saves the sleep and tray behavior settings", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    const preventSleep = screen.getByRole("checkbox", {
      name: "Блокировка сна во время загрузки",
    });
    const minimizeToTray = screen.getByRole("checkbox", { name: "Свернуть в трей" });

    expect(preventSleep).not.toBeChecked();
    expect(minimizeToTray).toBeChecked();
    expect(screen.getByRole("img", {
      name: /не даёт системе автоматически перейти в спящий режим/i,
    })).toHaveAttribute("tabindex", "0");
    const trayHelp = screen.getByRole("img", {
      name: /продолжит работать в фоне через системный значок/i,
    });
    expect(trayHelp).toHaveAttribute("tabindex", "0");
    expect(trayHelp.getAttribute("data-tooltip")).not.toMatch(/выйти|выход/i);

    await userEvent.click(preventSleep);
    expect(api.updateSettings).toHaveBeenCalledWith({
      preventSystemSleepWhileDownloading: true,
    });

    await userEvent.click(minimizeToTray);
    expect(api.updateSettings).toHaveBeenCalledWith({ minimizeToTray: false });
  });

  it("switches the entire interface to English and persists the language", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await selectParameter(/язык интерфейса/i, "en");

    expect(screen.getByRole("region", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New download" }));
    expect(screen.getByRole("tab", { name: "Video" })).toBeInTheDocument();
    expect(screen.getByLabelText("Video URL")).toBeInTheDocument();
    expect(window.localStorage.getItem(localeStorageKey)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("saves the simultaneous downloads setting", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /загрузки/i }));
    const concurrencySlider = screen.getByRole("slider", { name: /одновременных загрузок/i });

    expect(concurrencySlider).toHaveAttribute("data-value", "2");
    expect(screen.getByRole("button", { name: "Установить Количество одновременных загрузок: 6" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Установить Количество одновременных загрузок: 8" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Установить Количество одновременных загрузок: 16" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Установить Количество одновременных загрузок: 6" }));

    expect(api.updateSettings).toHaveBeenCalledWith({ concurrency: 6 });
  });

  it("saves the technical video filename preference from Downloads settings", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    expect(screen.queryByLabelText(/добавлять технические параметры в название видео/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /загрузки/i }));
    const checkbox = screen.getByLabelText(/добавлять технические параметры в название видео/i);
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);

    expect(api.updateSettings).toHaveBeenCalledWith({
      includeVideoTechnicalDetailsInFilename: true,
    });
  });

  it("uses a newly saved default folder in new downloads and playlists", async () => {
    const initialSettings = await api.getSettings();
    vi.mocked(api.updateSettings).mockResolvedValueOnce({ ...initialSettings, defaultDownloadDir: "D:/Video" });
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /загрузки/i }));
    await userEvent.click(screen.getByRole("button", { name: "Обзор" }));

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ defaultDownloadDir: "D:/Video" }));
    await userEvent.click(screen.getByRole("button", { name: "Новая загрузка" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Папка загрузки" })).toHaveValue("D:/Video"));
    await userEvent.click(screen.getByRole("button", { name: "Плейлист" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ссылка на плейлист" }), {
      target: { value: "https://www.youtube.com/playlist?list=PL-default-folder" },
    });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Папка загрузки" })).toHaveValue("D:/Video"));
  });

  it("saves a filename template and only the two requested collision choices", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /загрузки/i }));

    await selectParameter("Шаблон имени файла", "channel-title");
    expect(api.updateSettings).toHaveBeenCalledWith({ filenameTemplate: "channel-title" });
    const collisionMenu = await openParameterMenu("При совпадении имён");
    expect(within(collisionMenu).getAllByRole("option")).toHaveLength(2);
    await userEvent.click(optionByValue(collisionMenu, "replace"));
    expect(api.updateSettings).toHaveBeenCalledWith({ filenameCollisionPolicy: "replace" });
  });

  it("saves an authenticated SOCKS5 proxy without putting its password in a visible field", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /сеть/i }));
    await selectParameter("Прокси", "socks5");
    await userEvent.type(screen.getByRole("textbox", { name: "Сервер" }), "proxy.example");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Порт" }), "1080");
    await userEvent.type(screen.getByRole("textbox", { name: "Логин" }), "test-user");
    await userEvent.type(screen.getByLabelText("Пароль"), "test-secret");
    expect(screen.getByLabelText("Пароль")).toHaveAttribute("type", "password");
    await userEvent.click(screen.getAllByRole("button", { name: "Сохранить" })[0]);

    expect(api.updateSettings).toHaveBeenCalledWith({
      proxyMode: "socks5", proxyHost: "proxy.example", proxyPort: 1080,
      proxyUsername: "test-user", proxyPassword: "test-secret",
    });
  });

  it("applies system and no-proxy modes without an extra save action", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /сеть/i }));

    expect(screen.getAllByRole("button", { name: "Сохранить" })).toHaveLength(1);
    await selectParameter("Прокси", "none");

    expect(api.updateSettings).toHaveBeenCalledWith({ proxyMode: "none" });
    expect(screen.queryByRole("textbox", { name: "Сервер" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Сохранить" })).toHaveLength(1);
  });

  it("uses the calm hover state in custom parameter menus", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    const menu = await openParameterMenu(/браузер для входа/i);
    const option = optionByValue(menu, "brave");

    await userEvent.hover(option);

    expect(option).toHaveClass("active");
    expect(option).not.toHaveClass("selected");
  });

  it.each([
    { concurrency: 1, riskLabel: "низкий" },
    { concurrency: 2, riskLabel: "умеренный" },
    { concurrency: 4, riskLabel: "повышенный" },
    { concurrency: 6, riskLabel: "высокий" },
    { concurrency: 8, riskLabel: "очень высокий" },
  ])("shows $concurrency simultaneous downloads as $riskLabel IP risk", async ({ concurrency, riskLabel }) => {
    vi.mocked(api.getSettings).mockResolvedValueOnce({
      concurrency,
      fragmentConcurrency: 1,
      downloadRetries: 10,
      fileAccessRetries: 3,
      fragmentRetries: 10,
      customUserAgentEnabled: false,
      customUserAgent: "",
      includeVideoTechnicalDetailsInFilename: false,
      filenameTemplate: "title",
      filenameCollisionPolicy: "rename",
      playlistFormatSelectionMode: "strict",
      preventSystemSleepWhileDownloading: false,
      minimizeToTray: true,
      completionSoundEnabled: false,
      showThumbnails: true,
      accentColor: "blue",
      proxyMode: "system",
      proxyHost: "",
      proxyPort: 0,
      proxyUsername: "",
      proxyPasswordSet: false,
    });
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /загрузки/i }));
    const concurrencyField = screen.getByRole("slider", { name: /одновременных загрузок/i }).closest<HTMLElement>(".settings-field");

    expect(concurrencyField).not.toBeNull();
    expect(within(concurrencyField!).getByLabelText(`Риск ограничений IP: ${riskLabel}`)).toBeInTheDocument();
  });

  it("changes the simultaneous downloads slider from the keyboard", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /загрузки/i }));
    const concurrencySlider = screen.getByRole("slider", { name: /одновременных загрузок/i });
    concurrencySlider.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(api.updateSettings).toHaveBeenCalledWith({ concurrency: 4 });
  });

  it("saves the network connections per video setting", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /загрузки/i }));
    const connectionsSlider = screen.getByRole("slider", { name: /соединений \(фрагментов\) на видео/i });
    const connectionsField = connectionsSlider.closest<HTMLElement>(".settings-field");

    expect(screen.queryByRole("button", { name: "Установить Соединений (фрагментов) на видео: 16" })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/риск ограничений IP: низкий/i)).toHaveLength(1);
    expect(connectionsField).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Установить Соединений (фрагментов) на видео: 4" }));

    expect(api.updateSettings).toHaveBeenCalledWith({ fragmentConcurrency: 4 });
    expect(within(connectionsField!).getByLabelText(/риск ограничений IP: повышенный/i)).toBeInTheDocument();
  });

  it("shows strict playlist matching by default and saves adaptive mode from Downloads settings", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /загрузки/i }));

    const mode = screen.getByRole("combobox", { name: "Подбор форматов плейлиста" });
    const playlistSection = mode.closest<HTMLElement>(".settings-section");
    const downloadsSection = screen.getByRole("heading", { name: "Поведение" }).closest<HTMLElement>(".settings-section");
    const fileNamesSection = screen.getByRole("heading", { name: "Имена файлов" }).closest<HTMLElement>(".settings-section");
    const technicalNames = screen.getByRole("checkbox", { name: "Добавлять технические параметры в название видео" });
    expect(playlistSection).not.toBe(downloadsSection);
    expect(fileNamesSection).not.toBe(downloadsSection);
    expect(fileNamesSection).toContainElement(technicalNames);
    expect(within(playlistSection!).getByRole("heading", { name: "Плейлисты" })).toBeInTheDocument();
    expect(mode).toHaveTextContent("Строгий");
    const help = screen.getByRole("img", { name: /адаптивный режим скачивает видео/i });
    expect(help).toHaveAttribute("tabindex", "0");
    expect(help.parentElement).toHaveClass("settings-field-label-with-help");

    await userEvent.click(mode);
    const menu = screen.getByRole("listbox", { name: "Подбор форматов плейлиста" });
    expect(within(menu).getByText("Только точные совпадения выбранных параметров"))
      .toHaveAttribute("title", "Только точные совпадения выбранных параметров");
    expect(within(menu).getByText("Ближайшие доступные параметры при отсутствии точного формата"))
      .toHaveAttribute("title", "Ближайшие доступные параметры при отсутствии точного формата");
    await userEvent.click(optionByValue(menu, "adaptive"));

    expect(api.updateSettings).toHaveBeenCalledWith({ playlistFormatSelectionMode: "adaptive" });
  });

  it("saves download, file access, and fragment retry settings", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /загрузки/i }));

    const downloadRetries = screen.getByRole("spinbutton", { name: "Попыток загрузки" });
    const fileAccessRetries = screen.getByRole("spinbutton", { name: "Повторов доступа к файлу" });
    const fragmentRetries = screen.getByRole("spinbutton", { name: "Повторов фрагмента" });
    expect(downloadRetries).toHaveValue(3);
    expect(fileAccessRetries).toHaveValue(3);
    expect(fragmentRetries).toHaveValue(3);
    expect(downloadRetries).toHaveAttribute("max", "30");
    expect(fileAccessRetries).toHaveAttribute("max", "10");
    expect(fragmentRetries).toHaveAttribute("max", "30");

    const downloadRetriesLabel = screen.getByText("Попыток загрузки", { selector: ".settings-retry-label" });
    const downloadRetriesTooltip = screen.getByRole("tooltip", {
      name: /повторит всю загрузку после временной сетевой ошибки/i,
    });
    expect(downloadRetriesLabel).toHaveAttribute("tabindex", "0");
    expect(downloadRetriesLabel).toHaveAttribute("aria-describedby", downloadRetriesTooltip.id);
    expect(screen.getByRole("tooltip", { name: /файл временно занят или недоступен на диске/i })).toBeInTheDocument();
    expect(screen.getByRole("tooltip", { name: /отдельную часть видео/i })).toBeInTheDocument();

    fireEvent.change(downloadRetries, { target: { value: "25" } });
    fireEvent.blur(downloadRetries);
    expect(api.updateSettings).toHaveBeenCalledWith({ downloadRetries: 25 });

    fireEvent.change(fileAccessRetries, { target: { value: "100" } });
    fireEvent.blur(fileAccessRetries);
    expect(api.updateSettings).toHaveBeenCalledWith({ fileAccessRetries: 10 });

    await userEvent.click(screen.getByRole("button", { name: "По умолчанию" }));
    expect(api.updateSettings).toHaveBeenCalledWith({
      downloadRetries: 3,
      fileAccessRetries: 3,
      fragmentRetries: 3,
    });
  });

  it("enables a custom User-Agent only after a value is entered", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /сеть/i }));

    const toggle = screen.getByLabelText("Использовать пользовательский User-Agent");
    const input = screen.getByRole("textbox", { name: "User-Agent" });
    expect(toggle).toBeDisabled();

    await userEvent.type(input, "Mozilla/5.0 TestBrowser/1.0");
    expect(toggle).toBeEnabled();
    await userEvent.click(toggle);

    expect(api.updateSettings).toHaveBeenCalledWith({
      customUserAgentEnabled: true,
      customUserAgent: "Mozilla/5.0 TestBrowser/1.0",
    });
  });

  it("keeps queue ordered by running, pending, failed, then cancelled jobs and hides completed rows", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 1,
        state: "Cancelled",
        request: {
          url: "https://youtube.com/watch?v=cancelled",
          title: "Cancelled Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 2,
        state: "Completed",
        progressPercent: 100,
        request: {
          url: "https://youtube.com/watch?v=done",
          title: "Done Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 3,
        state: "Failed",
        error: "Ошибка загрузки",
        request: {
          url: "https://youtube.com/watch?v=fail",
          title: "Failed Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 4,
        state: "Pending",
        request: {
          url: "https://youtube.com/watch?v=wait",
          title: "Waiting Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 5,
        state: "Running",
        progressPercent: 12,
        request: {
          url: "https://youtube.com/watch?v=run",
          title: "Running Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);
    await openQueueSection();

    const rows = await screen.findAllByRole("listitem");
    expect(within(rows[0]).getByText("Running Video")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Waiting Video")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Failed Video")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Cancelled Video")).toBeInTheDocument();
    expect(screen.queryByText("Done Video")).not.toBeInTheDocument();
  });

  it("uses clear preset labels", async () => {
    render(<App />);

    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");

    expect(screen.queryByText(/Видео: лучшее/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Лучшее качество/i)).toBeInTheDocument();
  });

  it("lets the user pick a destination folder", async () => {
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /обзор/i }));

    expect(api.selectDownloadDir).toHaveBeenCalled();
    expect(screen.getByDisplayValue("D:/Video")).toBeInTheDocument();
  });

  it("passes browser cookies when the early access option is enabled", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /авторизация/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await userEvent.click(screen.getByRole("button", { name: "Новая загрузка" }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");

    expect(api.probeUrl).toHaveBeenCalledWith("https://youtube.com/watch?v=x", {
      kind: "browser",
      value: { browser: "chrome", profile: null },
    }, expect.any(String));
  });

  it("passes analyzed title into the download request", async () => {
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");
    await userEvent.click(screen.getByRole("button", { name: /скачать/i }));

    expect(api.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        formatLabel: "1080p 30fps MP4 AAC",
        thumbnail: "https://i.ytimg.com/example.jpg",
        title: "Example Video",
        url: "https://youtube.com/watch?v=x",
      }),
    );
  });

  it("shows audio settings for audio presets and submits them", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("tab", { name: /^Аудио/ }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");

    expect(screen.getByText("Настройки аудио")).toBeInTheDocument();
    await selectParameter(/битрейт/i, "320K");
    await selectParameter(/каналы/i, "stereo");
    await userEvent.click(screen.getByLabelText(/встраивать метаданные/i));
    await userEvent.click(screen.getByLabelText(/сохранять обложку/i));
    await userEvent.click(screen.getByRole("button", { name: /скачать/i }));

    expect(api.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "audioMp3",
        audioBitrate: "320K",
        audioChannels: "stereo",
        embedMetadata: true,
        embedThumbnail: true,
      }),
    );
  });

  it("disables stereo when the selected source audio is mono", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Mono Video",
      videoFormats: [],
      audioFormats: [{ formatId: "140", qualityLabel: "128kbps m4a", kind: "audio", audioChannels: 1 }],
    });
    render(<App />);

    await userEvent.click(screen.getByRole("tab", { name: /^Аудио/ }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=mono");
    await screen.findByText("Mono Video");

    expect(screen.getByRole("combobox", { name: "Каналы" })).toHaveAttribute("data-value", "source");
    const menu = await openParameterMenu("Каналы");
    const stereo = optionByValue(menu, "stereo");
    expect(stereo).toBeDisabled();
    expect(stereo).toHaveAttribute("title", "В источнике только mono");
  });

  it("warns before downmixing stereo source audio to mono", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Stereo Video",
      videoFormats: [],
      audioFormats: [{ formatId: "140", qualityLabel: "128kbps m4a", kind: "audio", audioChannels: 2 }],
    });
    render(<App />);

    await userEvent.click(screen.getByRole("tab", { name: /^Аудио/ }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=stereo");
    await screen.findByText("Stereo Video");
    await selectParameter("Каналы", "mono");

    expect(screen.getByText("Stereo будет сведено в mono.")).toBeInTheDocument();
  });

  it("shows saved download parameters in every queue row", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 11,
        state: "Cancelled",
        request: {
          url: "https://youtube.com/watch?v=params",
          title: "Params Video",
          preset: "mp4Video",
          formatId: "137",
          formatLabel: "1080p 60fps mp4",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);
    await openQueueSection();

    await screen.findByText("Params Video");
    const row = screen.getByText("Params Video").closest("li") as HTMLElement;

    expect(within(row).getByText(/MP4-видео/)).toBeInTheDocument();
    expect(within(row).getByText(/1080p 60fps mp4/)).toBeInTheDocument();
    expect(within(row).getByText(/D:\/Video/)).toBeInTheDocument();
  });

  it("shows a saved thumbnail in a queue row", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 61,
        state: "Running",
        progressPercent: 38,
        request: {
          url: "https://youtube.com/watch?v=running",
          title: "Running Video",
          thumbnail: "https://i.ytimg.com/running.jpg",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);
    await openQueueSection();

    await screen.findByText("Running Video");
    expect(screen.getByRole("img", { name: "Превью загрузки Running Video" })).toHaveAttribute(
      "src",
      "https://i.ytimg.com/running.jpg",
    );
  });

  it("hides queue and history thumbnails when the preference is off", async () => {
    const initialSettings = await api.getSettings();
    vi.mocked(api.getSettings).mockResolvedValueOnce({ ...initialSettings, showThumbnails: false });
    vi.mocked(api.getJobs).mockResolvedValueOnce([{
      id: 62, state: "Running",
      request: { url: "https://youtube.com/watch?v=running", title: "Running Video", thumbnail: "https://i.ytimg.com/running.jpg", preset: "mp4Video", destinationDir: "D:/Video" },
    }]);
    vi.mocked(api.getHistory).mockResolvedValueOnce([{
      id: "history-62", url: "https://youtube.com/watch?v=done", title: "Done Video", thumbnail: "https://i.ytimg.com/done.jpg", preset: "mp4Video", destinationDir: "D:/Video" , outputPath: "D:/Video/Done Video.mp4",
    }]);
    render(<App />);
    await openQueueSection();
    const queueTitle = await screen.findByText("Running Video");
    expect(queueTitle.closest(".job-row")).toHaveAttribute("data-no-thumbnail", "true");
    expect(screen.queryByRole("img", { name: "Превью загрузки Running Video" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "История" }));
    const historyTitle = await screen.findByText("Done Video");
    expect(historyTitle.closest(".history-row")).toHaveAttribute("data-no-thumbnail", "true");
  });

  it("hides playlist thumbnails from the saved preference and restores them when enabled", async () => {
    const initialSettings = await api.getSettings();
    vi.mocked(api.getSettings).mockResolvedValueOnce({ ...initialSettings, showThumbnails: false });
    vi.mocked(api.probePlaylist).mockResolvedValueOnce({
      id: "PL-thumbnails",
      title: "Thumbnail Playlist",
      thumbnail: "https://i.ytimg.com/playlist.jpg",
      entries: [{
        id: "thumbnail-item",
        index: 1,
        url: "https://youtube.com/watch?v=thumbnail-item",
        title: "Thumbnail Item",
        thumbnail: "https://i.ytimg.com/item.jpg",
        duration: 90,
      }],
    });
    vi.mocked(api.probePlaylistItem).mockResolvedValueOnce({ entryId: "thumbnail-item", state: "unavailable" });
    render(<App />);

    fireEvent.change(screen.getByLabelText(/ссылка на видео/i), {
      target: { value: "https://youtube.com/playlist?list=PL-thumbnails" },
    });
    expect(await screen.findByText("Thumbnail Playlist")).toBeInTheDocument();
    expect(document.querySelector(".playlist-cover, .playlist-cover-placeholder, .playlist-row-thumbnail, .playlist-row-thumb-placeholder")).toBeNull();

    vi.mocked(api.updateSettings).mockResolvedValueOnce({ ...initialSettings, showThumbnails: true });
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /внешний вид/i }));
    await userEvent.click(screen.getByRole("switch", { name: "Показывать миниатюры" }));
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ showThumbnails: true }));
    await userEvent.click(screen.getByRole("button", { name: /^Плейлист$/ }));

    expect(await screen.findByAltText("Thumbnail Playlist")).toHaveAttribute("src", "https://i.ytimg.com/playlist.jpg");
    expect(screen.getByAltText("Thumbnail Item")).toHaveAttribute("src", "https://i.ytimg.com/item.jpg");

    await userEvent.click(screen.getByRole("button", { name: "Показать список сверху" }));
    expect(screen.getByAltText("Thumbnail Playlist")).toBeInTheDocument();
    expect(screen.getByAltText("Thumbnail Item")).toBeInTheDocument();

    vi.mocked(api.updateSettings).mockResolvedValueOnce({ ...initialSettings, showThumbnails: false });
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /внешний вид/i }));
    await userEvent.click(screen.getByRole("switch", { name: "Показывать миниатюры" }));
    await userEvent.click(screen.getByRole("button", { name: /^Плейлист$/ }));
    expect(document.querySelector(".playlist-cover, .playlist-cover-placeholder, .playlist-row-thumbnail, .playlist-row-thumb-placeholder")).toBeNull();
  });

  it("keeps stable order within queue state groups and omits completed jobs", async () => {
    const job = (id: number, state: Job["state"], title: string): Job => ({
      id,
      state,
      request: {
        url: `https://youtube.com/watch?v=${id}`,
        title,
        preset: "mp4Video",
        destinationDir: "D:/Video",
      },
    });
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      job(10, "Pending", "Pending older"),
      job(11, "Completed", "Completed older"),
      job(12, "Running", "Running older"),
      job(13, "Completed", "Completed newer"),
      job(14, "Failed", "Failed older"),
      job(15, "Cancelled", "Cancelled older"),
      job(16, "Running", "Running newer"),
      job(17, "Pending", "Pending newer"),
      job(18, "Failed", "Failed newer"),
      job(19, "Cancelled", "Cancelled newer"),
    ]);

    render(<App />);
    await openQueueSection();

    await screen.findByText("Running older");
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".job-row"));
    expect(rows.map((row) => row.querySelector(".job-title")?.textContent)).toEqual([
      "Running older",
      "Running newer",
      "Pending older",
      "Pending newer",
      "Failed older",
      "Failed newer",
      "Cancelled older",
      "Cancelled newer",
    ]);
  });

  it("clears only failed and cancelled jobs from the queue", async () => {
    vi.mocked(api.getJobs)
      .mockResolvedValueOnce([
        {
          id: 1,
          state: "Completed",
          request: { url: "https://youtube.com/watch?v=completed", title: "Completed Video", preset: "mp4Video", destinationDir: "D:/Video" },
        },
        {
          id: 2,
          state: "Failed",
          error: "Download error",
          request: { url: "https://youtube.com/watch?v=failed", title: "Failed Video", preset: "mp4Video", destinationDir: "D:/Video" },
        },
        {
          id: 3,
          state: "Cancelled",
          request: { url: "https://youtube.com/watch?v=cancelled", title: "Cancelled Video", preset: "mp4Video", destinationDir: "D:/Video" },
        },
        {
          id: 4,
          state: "Running",
          request: { url: "https://youtube.com/watch?v=running", title: "Running Video", preset: "mp4Video", destinationDir: "D:/Video" },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 4,
          state: "Running",
          request: { url: "https://youtube.com/watch?v=running", title: "Running Video", preset: "mp4Video", destinationDir: "D:/Video" },
        },
      ]);
    render(<App />);
    await openQueueSection();

    await screen.findByText("Failed Video");
    await userEvent.click(screen.getByRole("button", { name: /очистить очередь/i }));

    expect(api.clearJobs).toHaveBeenCalled();
    expect(screen.queryByText("Completed Video")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed Video")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancelled Video")).not.toBeInTheDocument();
    expect(screen.getByText("Running Video")).toBeInTheDocument();
  });

  it("pauses all running and pending downloads", async () => {
    vi.mocked(api.getJobs)
      .mockResolvedValueOnce([
        {
          id: 1,
          state: "Running",
          progressPercent: 12,
          request: {
            url: "https://youtube.com/watch?v=run",
            title: "Running Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
        {
          id: 2,
          state: "Running",
          request: {
            url: "https://youtube.com/watch?v=run-two",
            title: "Second Running Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
        {
          id: 3,
          state: "Pending",
          request: {
            url: "https://youtube.com/watch?v=wait",
            title: "Waiting Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 1,
          state: "Paused",
          request: {
            url: "https://youtube.com/watch?v=run",
            title: "Running Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
        {
          id: 2,
          state: "Paused",
          request: {
            url: "https://youtube.com/watch?v=run-two",
            title: "Second Running Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
        {
          id: 3,
          state: "Paused",
          request: {
            url: "https://youtube.com/watch?v=wait",
            title: "Waiting Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
      ]);
    render(<App />);
    await openQueueSection();

    await screen.findByText("Running Video");
    await userEvent.click(screen.getByRole("button", { name: /приостановить всё/i }));

    expect(api.pauseAllJobs).toHaveBeenCalled();
    expect(screen.getAllByText("Пауза")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /продолжить все/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /отменить все/i })).toBeInTheDocument();
  });

  it("enables pause all only for two or more running downloads", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 1,
        state: "Running",
        request: {
          url: "https://youtube.com/watch?v=run",
          title: "Running Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 2,
        state: "Pending",
        request: {
          url: "https://youtube.com/watch?v=wait",
          title: "Waiting Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);
    render(<App />);
    await openQueueSection();

    await screen.findByText("Running Video");

    expect(screen.getByRole("button", { name: /приостановить всё/i })).toBeDisabled();
  });

  it("always shows pause all and resumes only paused downloads", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 1,
        state: "Paused",
        request: {
          url: "https://youtube.com/watch?v=paused",
          title: "Paused Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 2,
        state: "Completed",
        request: {
          url: "https://youtube.com/watch?v=done",
          title: "Done Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);
    render(<App />);
    await openQueueSection();

    await screen.findByText("Paused Video");
    expect(screen.getByRole("button", { name: /продолжить все/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /продолжить все/i }));

    expect(api.resumeAllJobs).toHaveBeenCalled();
    expect(api.pauseAllJobs).not.toHaveBeenCalled();
  });

  it("restores cancel all for two or more queued jobs", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 1,
        state: "Running",
        request: {
          url: "https://youtube.com/watch?v=run",
          title: "Running Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 2,
        state: "Pending",
        request: {
          url: "https://youtube.com/watch?v=wait",
          title: "Waiting Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);
    render(<App />);
    await openQueueSection();

    await screen.findByText("Running Video");
    expect(screen.getByRole("button", { name: /отменить все/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /отменить все/i }));

    expect(api.cancelAllJobs).toHaveBeenCalled();
  });

  it("retries failed and cancelled jobs with their original request", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 21,
        state: "Failed",
        error: "Ошибка загрузки",
        request: {
          url: "https://youtube.com/watch?v=failed",
          title: "Failed Video",
          preset: "mp4Video",
          formatId: "137",
          formatLabel: "1080p 60fps mp4",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 22,
        state: "Cancelled",
        request: {
          url: "https://youtube.com/watch?v=cancelled",
          title: "Cancelled Video",
          preset: "audioM4a",
          formatId: "140",
          formatLabel: "128kbps m4a",
          destinationDir: "D:/Audio",
        },
      },
    ]);
    render(<App />);
    await openQueueSection();

    await screen.findByText("Failed Video");
    const retryButtons = screen.getAllByRole("button", { name: /повторить загрузку/i });
    expect(retryButtons[0]).toHaveAttribute("title", "Повторить загрузку");
    await userEvent.click(retryButtons[0]);

    expect(retryButtons).toHaveLength(2);
    expect(api.retryJob).toHaveBeenCalledWith(21);
    expect(await screen.findByText("Retry Video")).toBeInTheDocument();
    expect(screen.queryByText("Failed Video")).not.toBeInTheDocument();
    expect(screen.getByText("Cancelled Video")).toBeInTheDocument();
  });

  it("hides the enqueue notice ten seconds after the latest successful download", async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=notice");
    const downloadButton = await screen.findByRole("button", { name: /скачать/i });
    await waitFor(() => expect(downloadButton).toBeEnabled());
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(downloadButton); });
    expect(screen.getByText("Видео добавлено в очередь")).toBeInTheDocument();
    const countdown = document.querySelector(".single-enqueue-result svg");
    expect(countdown).toHaveAttribute("aria-hidden", "true");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await act(async () => { fireEvent.click(downloadButton); });
    expect(api.enqueueDownload).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".single-enqueue-result svg")).not.toBe(countdown);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.getByText("Видео добавлено в очередь")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(screen.getByText("Видео добавлено в очередь")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByText("Видео добавлено в очередь")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/ссылка на видео/i)).toHaveValue("https://youtube.com/watch?v=notice");
  });

  it("allows adding another download while the previous one stays in the queue", async () => {
    vi.mocked(api.probeUrl)
      .mockResolvedValueOnce({
        title: "First Video",
        uploader: "Channel",
        duration: 120,
        videoFormats: [{ formatId: "v1", qualityLabel: "1080p mp4", kind: "video" as const }],
        audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
      })
      .mockResolvedValueOnce({
        title: "Second Video",
        uploader: "Channel",
        duration: 120,
        videoFormats: [{ formatId: "v2", qualityLabel: "720p mp4", kind: "video" as const }],
        audioFormats: [{ formatId: "a2", qualityLabel: "128kbps m4a", kind: "audio" as const }],
      });
    vi.mocked(api.enqueueDownload)
      .mockResolvedValueOnce({
        id: 1,
        state: "Running",
        progressPercent: 10,
        request: {
          url: "https://youtube.com/watch?v=first",
          title: "First Video",
          preset: "mp4Video",
          destinationDir: "C:/Users/TestUser/Downloads",
        },
      })
      .mockResolvedValueOnce({
        id: 2,
        state: "Pending",
        request: {
          url: "https://youtube.com/watch?v=second",
          title: "Second Video",
          preset: "mp4Video",
          destinationDir: "C:/Users/TestUser/Downloads",
        },
      });
    render(<App />);

    const urlInput = screen.getByLabelText(/ссылка на видео/i);
    await userEvent.type(urlInput, "https://youtube.com/watch?v=first");
    await screen.findByText("First Video");
    await userEvent.click(screen.getByRole("button", { name: /скачать/i }));

    const resultText = await screen.findByText("Видео добавлено в очередь");
    const resultNotice = resultText.closest(".single-enqueue-result");
    const workspace = document.querySelector(".download-workspace");
    expect(resultNotice).not.toBeNull();
    expect(workspace).not.toBeNull();
    expect(workspace!.compareDocumentPosition(resultNotice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Пропущено/)).not.toBeInTheDocument();
    expect(urlInput).toHaveValue("https://youtube.com/watch?v=first");

    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, "https://youtube.com/watch?v=second");
    await screen.findByText("Second Video");
    await userEvent.click(screen.getByRole("button", { name: /скачать/i }));

    expect(api.enqueueDownload).toHaveBeenCalledTimes(2);
    await openQueueSection();
    const queuedRows = await screen.findAllByRole("listitem");
    expect(within(queuedRows[0]).getByText("First Video")).toBeInTheDocument();
    expect(within(queuedRows[1]).getByText("Second Video")).toBeInTheDocument();
  });

  it("opens the destination folder from History", async () => {
    vi.mocked(api.getHistory).mockResolvedValueOnce([
      {
        id: "history-7",
        url: "https://youtube.com/watch?v=done",
        title: "Downloaded Video",
        preset: "mp4Video",
        destinationDir: "D:/Video",
        outputPath: "D:/Video/Downloaded Video.mp4",
        completedAtMs: 1_700_000_000_000,
      },
    ]);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /^История$/ }));

    await screen.findByText("Downloaded Video");
    await userEvent.click(screen.getByRole("button", { name: /открыть папку/i }));

    expect(api.openDownloadFolder).toHaveBeenCalledWith("D:/Video");
  });

  it("removes one History record without touching another one", async () => {
    vi.mocked(api.getHistory).mockResolvedValueOnce([
      {
        id: "history-7",
        url: "https://youtube.com/watch?v=done",
        title: "Downloaded Video",
        preset: "mp4Video",
        destinationDir: "D:/Video",
      },
      {
        id: "history-8",
        url: "https://youtube.com/watch?v=keep",
        title: "Keep Video",
        preset: "mp4Video",
        destinationDir: "D:/Video",
      },
    ]);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /^История$/ }));

    await screen.findByText("Downloaded Video");
    const row = screen.getByText("Downloaded Video").closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /удалить запись/i }));

    expect(api.removeHistoryItem).toHaveBeenCalledWith("history-7");
    expect(screen.queryByText("Downloaded Video")).not.toBeInTheDocument();
    expect(screen.getByText("Keep Video")).toBeInTheDocument();
  });

  it("moves a finished job out of Queue and into History", async () => {
    let onFinished: ((event: any) => void) | undefined;
    vi.mocked(api.getJobs).mockResolvedValueOnce([{ id: 8, state: "Running", request: { url: "https://youtube.com/watch?v=done", title: "Downloaded Video", preset: "mp4Video", destinationDir: "D:/Video" } }]);
    vi.mocked(api.onDownloadFinished).mockImplementationOnce(async (callback) => {
      onFinished = callback;
      return () => undefined;
    });

    render(<App />);
    await openQueueSection();
    await screen.findByText("Downloaded Video");
    await act(async () => onFinished?.({
      job: { id: 8, state: "Completed", request: { url: "https://youtube.com/watch?v=done", title: "Downloaded Video", preset: "mp4Video", destinationDir: "D:/Video" } },
      outputPath: "D:/Video/Downloaded Video.mp4",
      history: { id: "history-8", url: "https://youtube.com/watch?v=done", title: "Downloaded Video", preset: "mp4Video", destinationDir: "D:/Video", outputPath: "D:/Video/Downloaded Video.mp4" },
    }));

    expect(screen.queryByText("Downloaded Video")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^История$/ }));
    expect(await screen.findByText("Downloaded Video")).toBeInTheDocument();
  });

  it("uses blue progress for running jobs and omits completed queue rows", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 31,
        state: "Running",
        progressPercent: 44,
        request: {
          url: "https://youtube.com/watch?v=run",
          title: "Running Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 32,
        state: "Completed",
        progressPercent: 100,
        request: {
          url: "https://youtube.com/watch?v=done",
          title: "Done Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);
    await openQueueSection();

    await screen.findByText("Running Video");

    expect(screen.getByLabelText("Прогресс 31").firstElementChild).toHaveClass("running");
    expect(screen.queryByText("Done Video")).not.toBeInTheDocument();
  });

  it("shows a separate animated progress state while converting audio", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 33,
        state: "Running",
        phase: "PostProcessing",
        progressPercent: 100,
        request: {
          url: "https://youtube.com/watch?v=convert",
          title: "Converting Audio",
          preset: "audioMp3",
          destinationDir: "D:/Audio",
        },
      },
    ]);

    render(<App />);
    await openQueueSection();

    await screen.findByText("Converting Audio");

    expect(screen.getByLabelText("Прогресс 33").firstElementChild).toHaveClass("post-processing");
    expect(screen.getByText("Конвертация аудио…")).toBeInTheDocument();
  });

  it("shows separate video, audio-track, and merging stages for video jobs", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 34,
        state: "Running",
        phase: "DownloadingVideo",
        progressPercent: 48,
        request: {
          url: "https://youtube.com/watch?v=video-stream",
          title: "Video stream",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 35,
        state: "Running",
        phase: "DownloadingAudio",
        progressPercent: 27,
        request: {
          url: "https://youtube.com/watch?v=audio-stream",
          title: "Audio stream",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 36,
        state: "Running",
        phase: "Merging",
        progressPercent: 100,
        request: {
          url: "https://youtube.com/watch?v=merge",
          title: "Merge streams",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);
    await openQueueSection();

    await screen.findByText("Video stream");

    expect(screen.getByText("Скачивание видео…")).toBeInTheDocument();
    expect(screen.getByText("Скачивание аудиодорожки…")).toBeInTheDocument();
    expect(screen.getByText("Слияние видео и аудио…")).toBeInTheDocument();
    expect(screen.getByLabelText("Прогресс 36").firstElementChild).toHaveClass("post-processing");
  });

  it("pauses and resumes downloads from the queue", async () => {
    vi.mocked(api.getJobs)
      .mockResolvedValueOnce([
        {
          id: 41,
          state: "Running",
          progressPercent: 50,
          request: {
            url: "https://youtube.com/watch?v=run",
            title: "Running Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
        {
          id: 42,
          state: "Paused",
          progressPercent: 25,
          request: {
            url: "https://youtube.com/watch?v=pause",
            title: "Paused Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 41,
          state: "Paused",
          progressPercent: 50,
          request: {
            url: "https://youtube.com/watch?v=run",
            title: "Running Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
        {
          id: 42,
          state: "Paused",
          progressPercent: 25,
          request: {
            url: "https://youtube.com/watch?v=pause",
            title: "Paused Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 42,
          state: "Pending",
          progressPercent: 25,
          request: {
            url: "https://youtube.com/watch?v=pause",
            title: "Paused Video",
            preset: "mp4Video",
            destinationDir: "D:/Video",
          },
        },
      ]);
    render(<App />);
    await openQueueSection();

    await screen.findByText("Running Video");
    await userEvent.click(screen.getByRole("button", { name: /пауза running video/i }));
    await userEvent.click(screen.getByRole("button", { name: /продолжить paused video/i }));

    expect(api.pauseJob).toHaveBeenCalledWith(41);
    expect(api.resumeJob).toHaveBeenCalledWith(42);
  });

  it("exposes the full queue title in a keyboard-accessible tooltip", async () => {
    const title = "An intentionally long video title that remains available in the queue tooltip";
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 76,
        state: "Pending",
        request: {
          url: "https://youtube.com/watch?v=long-title",
          title,
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);
    render(<App />);
    await openQueueSection();

    const titleText = await screen.findByText(title, { selector: ".job-title" });
    const titleTrigger = titleText.parentElement as HTMLElement;
    expect(titleTrigger).toHaveAttribute("tabindex", "0");

    await act(async () => {
      titleTrigger.focus();
    });
    const tooltip = screen.getAllByRole("tooltip").find((element) => element.textContent === title);

    expect(tooltip).toBeDefined();
    expect(tooltip).toHaveTextContent(title);
    expect(titleTrigger).toHaveAttribute("aria-describedby", (tooltip as HTMLElement).id);
    expect(titleTrigger).toHaveFocus();
  });

  it("hides progress details for a failed job", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 12,
        state: "Failed",
        progressPercent: 44,
        speed: "4.40MiB/s",
        eta: "00:57",
        error: "Ошибка загрузки",
        request: {
          url: "https://youtube.com/watch?v=failed",
          title: "Failed Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);
    await openQueueSection();

    await screen.findByText("Failed Video");

    expect(screen.getByText("Ошибка загрузки")).toBeInTheDocument();
    expect(screen.queryByText(/44%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/4.40MiB\/s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/00:57/)).not.toBeInTheDocument();
  });

  it("hides progress details for a cancelled job", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 9,
        state: "Cancelled",
        progressPercent: 42,
        speed: "3.50MiB/s",
        eta: "00:17",
        request: {
          url: "https://youtube.com/watch?v=cancelled",
          title: "Cancelled Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);
    await openQueueSection();

    await screen.findByText("Cancelled Video");

    expect(screen.queryByLabelText("Прогресс 9")).not.toBeInTheDocument();
    expect(screen.queryByText(/42%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/3.50MiB\/s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/00:17/)).not.toBeInTheDocument();
  });

  it("uses human-readable labels for video resolutions", async () => {
    vi.mocked(api.probeUrl).mockReset();
    vi.mocked(api.probeUrl).mockResolvedValue({
      title: "Resolution Labels",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        { formatId: "v2160", qualityLabel: "2160p 60fps WebM VP9", kind: "video" as const, ext: "webm", codec: "vp9", width: 3840, height: 2160, fps: 60 },
        { formatId: "v1080", qualityLabel: "1080p 60fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.64002a", width: 1920, height: 1080, fps: 60 },
        { formatId: "v720", qualityLabel: "720p 60fps MP4 H.264", kind: "video" as const, ext: "mp4", codec: "avc1.4d4020", width: 1280, height: 720, fps: 60 },
      ],
      audioFormats: [{ formatId: "a1", qualityLabel: "128kbps m4a", kind: "audio" as const }],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=labels");
    await screen.findByText("Resolution Labels");
    await openVideoAdvancedSettings();

    const resolution = screen.getByLabelText("Разрешение");
    const resolutionMenu = await openParameterMenu("Разрешение");
    expect(within(resolutionMenu).getByRole("option", { name: "3840×2160 (4K UHD)" })).toBeInTheDocument();
    expect(within(resolutionMenu).getByRole("option", { name: "1920×1080 (Full HD)" })).toBeInTheDocument();
    expect(within(resolutionMenu).getByRole("option", { name: "1280×720 (HD)" })).toBeInTheDocument();
    expect(resolution).toHaveAttribute("data-value", "all");
  });
});

async function openVideoAdvancedSettings() {
  const toggle = screen.getByRole("button", { name: /дополнительно/i });
  if (toggle.getAttribute("aria-expanded") === "false") {
    await userEvent.click(toggle);
  }
}

async function openQueueSection() {
  await userEvent.click(screen.getByRole("button", { name: /^Очередь$|^Queue$/ }));
}

async function openParameterMenu(label: string | RegExp) {
  const trigger = screen.getByRole("combobox", { name: label });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(trigger);
  }
  return screen.getByRole("listbox", { name: label });
}

function optionByValue(menu: HTMLElement, value: string) {
  const option = menu.querySelector(`[role="option"][data-value="${value}"]`);
  expect(option).not.toBeNull();
  return option as HTMLElement;
}

async function selectParameter(label: string | RegExp, value: string) {
  const menu = await openParameterMenu(label);
  await userEvent.click(optionByValue(menu, value));
}
