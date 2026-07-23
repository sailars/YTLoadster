import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import App from "./App";
import { api } from "./lib/api";
import { themeStorageKey } from "./lib/theme";
import { localeStorageKey } from "./lib/i18n";
import { notificationsStorageKey } from "./lib/notifications";
import * as youtubeAuth from "./lib/youtubeAuth";
import "./styles.css";

vi.mock("./lib/api", () => ({
  api: {
    getAppStatus: vi.fn().mockResolvedValue({ name: "YTLoadster", ready: true, platform: "windows" }),
    getDefaultDownloadDir: vi.fn().mockResolvedValue("C:/Users/TestUser/Downloads"),
    getSettings: vi.fn().mockResolvedValue({ concurrency: 2, fragmentConcurrency: 1, includeVideoTechnicalDetailsInFilename: false }),
    getYoutubeAuthStatus: vi.fn().mockResolvedValue({
      supported: true,
      authenticated: false,
      browser: null,
    }),
    startYoutubeAuth: vi.fn().mockResolvedValue({
      browser: "Microsoft Edge",
      websocketUrl: null,
    }),
    startYoutubeWebviewAuth: vi.fn().mockResolvedValue({
      browser: "WebView2",
      websocketUrl: null,
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
    }),
    prepareYoutubeAuthCapture: vi.fn().mockResolvedValue({
      browser: "Microsoft Edge",
      websocketUrl: "ws://127.0.0.1:9222/devtools/browser/test",
    }),
    completeYoutubeAuth: vi.fn().mockResolvedValue({
      supported: true,
      authenticated: true,
      browser: "Microsoft Edge",
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
    updateSettings: vi.fn().mockResolvedValue({ concurrency: 4, fragmentConcurrency: 4, includeVideoTechnicalDetailsInFilename: false }),
    selectDownloadDir: vi.fn().mockResolvedValue("D:/Video"),
    getToolStatus: vi.fn().mockResolvedValue({
      ytdlp: { name: "yt-dlp", state: "Found", path: "C:/app/yt-dlp.exe" },
      ffmpeg: { name: "ffmpeg", state: "Found", path: "C:/app/ffmpeg.exe" },
      ffprobe: { name: "ffprobe", state: "Found", path: "C:/app/ffprobe.exe" },
      jsRuntime: { name: "node", state: "Found", path: "C:/Program Files/nodejs/node.exe" },
    }),
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
    document.documentElement.classList.remove("theme-transitioning");
    vi.mocked(readText).mockResolvedValue("");
    vi.mocked(writeText).mockResolvedValue(undefined);
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    vi.mocked(requestPermission).mockResolvedValue("granted");
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
    expect(themeButton.querySelector(".sun-icon")).toBeInTheDocument();

    await userEvent.click(themeButton);

    const lightThemeButton = screen.getByRole("button", { name: /включить светлую тему/i });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");
    expect(lightThemeButton).toHaveAttribute("aria-pressed", "true");
    expect(lightThemeButton.querySelector(".moon-icon")).toBeInTheDocument();
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

  it("restores the saved dark theme", async () => {
    window.localStorage.setItem(themeStorageKey, "dark");

    render(<App />);

    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: /включить светлую тему/i }).querySelector(".moon-icon")).toBeInTheDocument();
  });

  it("shows the analyzed video preview actions and clears the URL field", async () => {
    render(<App />);

    const urlInput = screen.getByLabelText(/ссылка на видео/i);
    const pasteButton = screen.getByRole("button", { name: /вставить ссылку/i });
    const clearButton = screen.getByRole("button", { name: /очистить ссылку/i });
    expect(pasteButton).toHaveClass("url-action-button");
    expect(pasteButton).toHaveAttribute("title", "Вставить ссылку");
    expect(pasteButton.querySelector(".url-action-icon")).toBeInTheDocument();
    expect(clearButton).toHaveAttribute("title", "Очистить ссылку");
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
    expect(screen.getByRole("region", { name: "Итоговый файл" })).toBeInTheDocument();
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

    const summary = screen.getByRole("region", { name: "Итоговый файл" });
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
      includeVideoTechnicalDetailsInFilename: true,
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
    expect(screen.getByRole("region", { name: "Итоговый файл" })).toHaveTextContent("MP4 (H.264)");
    await selectParameter("Разрешение", "360");
    await selectParameter("Кодек", "VP9");

    const summary = screen.getByRole("region", { name: "Итоговый файл" });
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
    expect(within(screen.getByRole("region", { name: "Итоговый файл" })).getByRole("alert")).toBe(duplicateError);
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
    expect(within(screen.getByRole("region", { name: "Итоговый файл" })).getByRole("alert")).toBe(error);

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
    expect(within(screen.getByRole("region", { name: "Итоговый файл" })).getByRole("alert")).toBe(error);

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
    const summary = screen.getByRole("region", { name: "Итоговый файл" });
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

    await userEvent.click(screen.getByRole("button", { name: /вставить ссылку/i }));

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

    await userEvent.click(screen.getByRole("button", { name: /paste URL/i }));

    expect(await screen.findByText("The clipboard does not contain a text URL. Copy a URL and try again.")).toBeInTheDocument();
  });

  it("always shows cancel all but disables it without cancellable jobs", async () => {
    render(<App />);

    await screen.findByText("Заданий пока нет");

    expect(screen.getByRole("button", { name: /отменить все/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /очистить очередь/i })).toBeDisabled();
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

    await screen.findByText("Single Video");

    expect(screen.getByRole("button", { name: /отменить все/i })).toBeDisabled();
  });

  it("does not use a wait cursor for disabled buttons", async () => {
    render(<App />);

    await screen.findByText("Заданий пока нет");

    expect(getComputedStyle(screen.getByRole("button", { name: /очистить очередь/i })).cursor).toBe(
      "default",
    );
  });

  it("keeps queue bulk action buttons in a horizontal row", async () => {
    render(<App />);

    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");
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
    expect(screen.getByRole("region", { name: "Итоговый файл" })).toBeInTheDocument();
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

    expect(screen.getByRole("region", { name: "Итоговый файл" })).toHaveTextContent("MP4 (AV1)");

    await selectParameter("Контейнер", "webm");

    const summary = screen.getByRole("region", { name: "Итоговый файл" });
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
    expect(screen.getByRole("region", { name: "Итоговый файл" })).toHaveTextContent("MP4 (AV1)");
  });

  it("selects the best video and audio qualities after analysis", async () => {
    vi.mocked(api.probeUrl).mockResolvedValueOnce({
      title: "Sorted by UI",
      uploader: "Channel",
      duration: 120,
      videoFormats: [
        { formatId: "v720", qualityLabel: "720p 30fps mp4", kind: "video" as const },
        { formatId: "v1080", qualityLabel: "1080p 60fps mp4", kind: "video" as const },
      ],
      audioFormats: [
        { formatId: "a128", qualityLabel: "128kbps m4a", kind: "audio" as const },
        { formatId: "a256", qualityLabel: "256kbps m4a", kind: "audio" as const },
      ],
    });
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Sorted by UI");
    const summary = screen.getByRole("region", { name: "Итоговый файл" });
    expect(summary).toHaveTextContent("1080p");
    expect(summary).toHaveTextContent("60fps");
    await userEvent.click(screen.getByRole("button", { name: /скачать/i }));

    expect(api.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        formatId: "v1080",
      }),
    );
  });

  it("shows a readable browser cookies error", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "ERROR: could not find chrome cookies database in C:\\Users\\TestUser\\AppData",
    );
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await userEvent.click(screen.getByRole("button", { name: /закрыть настройки/i }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");

    expect(await screen.findByText(/Не удалось найти cookies Chrome/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not find chrome cookies database/i)).not.toBeInTheDocument();
  });

  it("shows a readable DPAPI error for Chromium cookies", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "ERROR: Failed to decrypt with DPAPI. See https://github.com/yt-dlp/yt-dlp/issues/10927 for more info",
    );
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await selectParameter(/браузер для входа/i, "brave");
    await userEvent.click(screen.getByRole("button", { name: /закрыть настройки/i }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");

    expect(await screen.findByText("Не удалось расшифровать cookies выбранного Chromium-браузера через защиту Windows (DPAPI). Некоторые Chromium-браузеры дополнительно защищают cookies, и программа не может их прочитать. Это не ошибка загрузчика: используйте Firefox/LibreWolf для входа или отключите вход через браузер")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to decrypt with DPAPI/i)).not.toBeInTheDocument();
  });

  it("shows a readable error when Chromium cookies are locked", async () => {
    vi.mocked(api.probeUrl).mockRejectedValueOnce(
      "ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info",
    );
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await selectParameter(/браузер для входа/i, "vivaldi");
    await userEvent.click(screen.getByRole("button", { name: /закрыть настройки/i }));
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
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await selectParameter(/браузер для входа/i, "firefox");
    await userEvent.click(screen.getByRole("button", { name: /закрыть настройки/i }));
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
        "Для этого видео YouTube требует войти в аккаунт и подтвердить возраст. Откройте Настройки → Вход в YouTube, выполните вход и повторите попытку. Если вход уже выполнен, убедитесь, что возраст подтверждён в аккаунте.",
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

    expect(await screen.findByText("YouTube просит подтвердить, что вы не робот. Войдите в аккаунт YouTube/авторизуйтесь через браузер в настройках приложения и повторите попытку.")).toBeInTheDocument();
    expect(screen.queryByText(/cookies-from-browser|github\.com|yt-dlp/i)).not.toBeInTheDocument();
  });

  it("offers Windows browser choices without Edge or Safari", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    const browserSelect = screen.getByLabelText(/браузер для входа/i);
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    const browserMenu = await openParameterMenu(/браузер для входа/i);

    for (const browser of ["Chrome", "Firefox", "LibreWolf", "Brave", "Vivaldi", "Opera"]) {
      expect(within(browserMenu).getByRole("option", { name: browser })).toBeInTheDocument();
    }
    expect(within(browserMenu).queryByRole("option", { name: /Safari/i })).not.toBeInTheDocument();
    expect(within(browserMenu).queryByRole("option", { name: "Edge" })).not.toBeInTheDocument();
    expect(browserSelect).toHaveAttribute("data-value", "chrome");
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

    expect(screen.getByRole("dialog", { name: /настройки/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /основное/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/использовать вход из браузера/i)).toBeInTheDocument();
  });

  it("explains the separate YouTube sign-in and keeps it available on Windows", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));

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
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);

    const warning = screen.getByRole("alertdialog", { name: /перед входом в YouTube/i });
    expect(within(warning).getByText(/выберите нужный аккаунт, если их несколько/i)).toBeInTheDocument();
    expect(within(warning).getByText(/дождитесь.+откроется YouTube/i)).toBeInTheDocument();
    expect(within(warning).getByText(/вручную закройте только это отдельное окно/i)).toBeInTheDocument();
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
    const loginButton = screen.getByRole("button", { name: /sign in to YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);

    const warning = screen.getByRole("alertdialog", { name: /before signing in to YouTube/i });
    expect(within(warning).getByText(/select the account.+if more than one is available/i)).toBeInTheDocument();
    expect(within(warning).getByText(/wait until YouTube opens/i)).toBeInTheDocument();
    expect(within(warning).getByText(/manually close only that separate browser window/i)).toBeInTheDocument();
    await userEvent.click(within(warning).getByRole("button", { name: "Continue" }));

    expect(api.startYoutubeAuth).toHaveBeenCalledWith("chrome");
  });

  it("uses the dark-theme surface for the browser sign-in warning", async () => {
    window.localStorage.setItem(themeStorageKey, "dark");
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
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

  it("reenables YouTube sign-in when the authentication browser is closed", async () => {
    vi.mocked(api.getYoutubeAuthWindowState).mockResolvedValueOnce({
      open: false,
      sessionDetected: false,
    });
    vi.spyOn(youtubeAuth, "readYoutubeAuthCookies").mockResolvedValueOnce([]);
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    await userEvent.click(screen.getByRole("button", { name: /понятно, продолжить/i }));

    expect(await screen.findByText(/окно браузера закрыто.+можно повторить/i)).toBeInTheDocument();
    expect(api.cancelYoutubeAuth).toHaveBeenCalledTimes(1);
    expect(loginButton).toBeEnabled();
  });

  it("shows that the account was detected and completes YouTube sign-in", async () => {
    vi.mocked(api.getYoutubeAuthWindowState)
      .mockResolvedValueOnce({ open: true, sessionDetected: true })
      .mockResolvedValueOnce({ open: false, sessionDetected: true });
    vi.spyOn(youtubeAuth, "readYoutubeAuthCookies").mockResolvedValueOnce([
      {
        name: "SAPISID",
        value: "session",
        domain: ".youtube.com",
        path: "/",
        expires: 1_900_000_000,
        secure: true,
      },
    ]);
    vi.spyOn(youtubeAuth, "closeYoutubeAuthBrowser").mockResolvedValue();
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    const loginButton = screen.getByRole("button", { name: /войти в YouTube/i });
    await waitFor(() => expect(loginButton).toBeEnabled());
    await userEvent.click(loginButton);
    await userEvent.click(screen.getByRole("button", { name: /понятно, продолжить/i }));

    expect(await screen.findByText(/аккаунт обнаружен.+закройте отдельное окно/i)).toBeInTheDocument();
    expect(await screen.findByText(/вход выполнен через Microsoft Edge/i, {}, { timeout: 4_000 })).toBeInTheDocument();
    expect(api.completeYoutubeAuth).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(youtubeAuth.closeYoutubeAuthBrowser).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(api.completeYoutubeAuth).mock.invocationCallOrder[0]);
  });

  it("clears saved YouTube sign-in data even when no session is active", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
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
    const logoutButton = await screen.findByRole("button", { name: /выйти из YouTube/i });
    expect(screen.queryByRole("button", { name: /очистить данные входа/i })).not.toBeInTheDocument();
    await userEvent.click(logoutButton);

    expect(api.signOutYoutube).toHaveBeenCalledTimes(1);
  });

  it("shows application details only in the About settings tab", async () => {
    render(<App />);

    await screen.findByDisplayValue("C:/Users/TestUser/Downloads");
    expect(screen.queryByText("0.1.0")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе/i }));

    expect(screen.getByRole("tab", { name: /о программе/i })).toHaveAttribute("aria-selected", "true");
    const aboutPanel = screen.getByRole("tabpanel", { name: /о программе/i });
    expect(aboutPanel).toBeInTheDocument();
    expect(within(aboutPanel).getByRole("heading", { name: "YTLoadster" })).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText(/программа для загрузки видео, аудио и субтитров/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/");
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

  it("opens settings on the Main tab after the dialog is reopened", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await userEvent.click(screen.getByRole("tab", { name: /о программе/i }));
    expect(screen.getByRole("tab", { name: /о программе/i })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("button", { name: /закрыть настройки/i }));
    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));

    expect(screen.getByRole("tab", { name: /основное/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/использовать вход из браузера/i)).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: /о программе/i })).not.toBeInTheDocument();
  });

  it("switches the entire interface to English and persists the language", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
    await selectParameter(/язык интерфейса/i, "en");

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Download queue" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Установить Одновременных загрузок: 6" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Установить Одновременных загрузок: 8" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Установить Одновременных загрузок: 16" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Установить Одновременных загрузок: 6" }));

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

  it("uses the calm hover state in custom parameter menus", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /настройки/i }));
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
      includeVideoTechnicalDetailsInFilename: false,
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
    const connectionsSlider = screen.getByRole("slider", { name: /соединений на видео/i });
    const connectionsField = connectionsSlider.closest<HTMLElement>(".settings-field");

    expect(screen.queryByRole("button", { name: "Установить Соединений на видео: 16" })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/риск ограничений IP: низкий/i)).toHaveLength(1);
    expect(connectionsField).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Установить Соединений на видео: 4" }));

    expect(api.updateSettings).toHaveBeenCalledWith({ fragmentConcurrency: 4 });
    expect(within(connectionsField!).getByLabelText(/риск ограничений IP: повышенный/i)).toBeInTheDocument();
  });

  it("keeps queue ordered by running, completed, pending, failed, then cancelled jobs", async () => {
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

    const rows = await screen.findAllByRole("listitem");
    expect(within(rows[0]).getByText("Running Video")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Done Video")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Waiting Video")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Failed Video")).toBeInTheDocument();
    expect(within(rows[4]).getByText("Cancelled Video")).toBeInTheDocument();
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
    await userEvent.click(screen.getByLabelText(/использовать вход из браузера/i));
    await userEvent.click(screen.getByRole("button", { name: /закрыть настройки/i }));
    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");

    expect(api.probeUrl).toHaveBeenCalledWith("https://youtube.com/watch?v=x", {
      kind: "browser",
      value: { browser: "chrome", profile: null },
    });
  });

  it("passes analyzed title into the download request", async () => {
    render(<App />);

    await userEvent.type(screen.getByLabelText(/ссылка на видео/i), "https://youtube.com/watch?v=x");
    await screen.findByText("Example Video");
    await userEvent.click(screen.getByRole("button", { name: /скачать/i }));

    expect(api.enqueueDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        formatLabel: "1080p 30fps mp4",
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

    await screen.findByText("Running Video");
    expect(screen.getByRole("img", { name: "Превью загрузки Running Video" })).toHaveAttribute(
      "src",
      "https://i.ytimg.com/running.jpg",
    );
  });

  it("clears only completed, failed, and cancelled jobs from the queue", async () => {
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

    await screen.findByText("Completed Video");
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

    await screen.findByText("Running Video");
    await userEvent.click(screen.getByRole("button", { name: /пауза всех/i }));

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

    await screen.findByText("Running Video");

    expect(screen.getByRole("button", { name: /пауза всех/i })).toBeDisabled();
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

    const firstJob = await screen.findByRole("listitem");
    expect(within(firstJob).getByText("First Video")).toBeInTheDocument();
    expect(urlInput).toHaveValue("https://youtube.com/watch?v=first");

    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, "https://youtube.com/watch?v=second");
    await screen.findByText("Second Video");
    await userEvent.click(screen.getByRole("button", { name: /скачать/i }));

    expect(api.enqueueDownload).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("First Video")).toHaveLength(1);
    expect(screen.getAllByText("Second Video")).toHaveLength(2);
  });

  it("opens the destination folder for a completed job", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 7,
        state: "Completed",
        progressPercent: 100,
        request: {
          url: "https://youtube.com/watch?v=done",
          title: "Downloaded Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);

    await screen.findByText("Downloaded Video");
    await userEvent.click(screen.getByRole("button", { name: /открыть папку/i }));

    expect(api.openDownloadFolder).toHaveBeenCalledWith("D:/Video");
  });

  it("removes one completed job from the queue row", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 7,
        state: "Completed",
        progressPercent: 100,
        request: {
          url: "https://youtube.com/watch?v=done",
          title: "Downloaded Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
      {
        id: 8,
        state: "Completed",
        progressPercent: 100,
        request: {
          url: "https://youtube.com/watch?v=keep",
          title: "Keep Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);

    await screen.findByText("Downloaded Video");
    const row = screen.getByText("Downloaded Video").closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /убрать из очереди/i }));

    expect(api.removeJob).toHaveBeenCalledWith(7);
    expect(screen.queryByText("Downloaded Video")).not.toBeInTheDocument();
    expect(screen.getByText("Keep Video")).toBeInTheDocument();
  });

  it("hides transfer details for a completed job", async () => {
    vi.mocked(api.getJobs).mockResolvedValueOnce([
      {
        id: 8,
        state: "Completed",
        progressPercent: 100,
        speed: "3.58MiB/s",
        eta: "NA",
        request: {
          url: "https://youtube.com/watch?v=done",
          title: "Downloaded Video",
          preset: "mp4Video",
          destinationDir: "D:/Video",
        },
      },
    ]);

    render(<App />);

    await screen.findByText("Downloaded Video");

    expect(screen.queryByText(/осталось/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/3.58MiB\/s/)).not.toBeInTheDocument();
  });

  it("uses blue progress for running jobs and green progress for completed jobs", async () => {
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

    await screen.findByText("Running Video");

    expect(screen.getByLabelText("Прогресс 31").firstElementChild).toHaveClass("running");
    expect(screen.getByLabelText("Прогресс 32").firstElementChild).toHaveClass("completed");
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
