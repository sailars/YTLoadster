import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import type { Job, MediaInfo, PlaylistInfo, PlaylistItemAnalysis } from "../lib/types";
import { api } from "../lib/api";
import { Playlist } from "./Playlist";
import "../styles.css";

vi.mock("../lib/api", () => ({
  api: {
    getDefaultDownloadDir: vi.fn().mockResolvedValue("C:/Downloads"),
    getAvailableDiskSpace: vi.fn().mockResolvedValue({ available: 100 * 1024 ** 3, total: 250 * 1024 ** 3 }),
    selectDownloadDir: vi.fn().mockResolvedValue("D:/Video"),
    probePlaylist: vi.fn(),
    beginPlaylistAnalysis: vi.fn().mockResolvedValue(undefined),
    cancelPlaylistAnalysis: vi.fn().mockResolvedValue(undefined),
    probePlaylistItem: vi.fn(),
    checkHistoryDuplicates: vi.fn().mockResolvedValue([]),
    enqueueDownloadBatch: vi.fn().mockResolvedValue({ queued: [], rejected: [] }),
  },
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
}));

const authSettings = {
  useBrowserCookies: false,
  useYoutubeSession: false,
  browser: "chrome",
};

function playlistInfo(count: number): PlaylistInfo {
  return {
    id: "PL-test",
    title: "Тестовый плейлист",
    uploader: "Канал",
    entries: Array.from({ length: count }, (_, index) => ({
      id: `item-${index + 1}`,
      index: index + 1,
      url: `https://youtube.com/watch?v=item-${index + 1}`,
      title: `Видео ${index + 1}`,
      duration: 60 + index,
    })),
  };
}

function media(id: string): MediaInfo {
  return {
    title: `Видео ${id}`,
    webpageUrl: `https://youtube.com/watch?v=${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration: 60,
    videoFormats: [{
      formatId: `v-${id}`,
      qualityLabel: "1080p 30fps MP4 H.264",
      kind: "video",
      ext: "mp4",
      codec: "avc1",
      height: 1080,
      fps: 30,
      filesize: 1_000_000,
    }],
    audioFormats: [{
      formatId: `a-${id}`,
      qualityLabel: "128kbps M4A",
      kind: "audio",
      ext: "m4a",
      codec: "mp4a",
      bitrateKbps: 128,
      filesize: 100_000,
      audioChannels: 2,
    }],
    subtitles: [],
  };
}

function ready(entryId: string): PlaylistItemAnalysis {
  return { entryId, state: "ready", media: media(entryId) };
}

function renderPlaylist(options: {
  jobs?: Job[];
  authenticated?: boolean;
  authSettings?: typeof authSettings;
  onJobsCreated?: (jobs: Job[]) => void;
  onUrlChange?: (url: string) => void;
  formatSelectionMode?: "strict" | "adaptive";
} = {}) {
  return render(playlistElement(options));
}

function playlistElement(options: {
  jobs?: Job[];
  authenticated?: boolean;
  authSettings?: typeof authSettings;
  onJobsCreated?: (jobs: Job[]) => void;
  onUrlChange?: (url: string) => void;
  formatSelectionMode?: "strict" | "adaptive";
} = {}) {
  return (
    <I18nProvider locale="ru">
      <Playlist
        url="https://youtube.com/playlist?list=PL-test"
        sourceIsPlaylist
        authSettings={options.authSettings ?? authSettings}
        authenticated={options.authenticated ?? false}
        includeVideoTechnicalDetailsInFilename={false}
        formatSelectionMode={options.formatSelectionMode ?? "strict"}
        jobs={options.jobs ?? []}
        finishedMediaSignatures={new Set()}
        onUrlChange={options.onUrlChange ?? vi.fn()}
        onJobsCreated={options.onJobsCreated ?? vi.fn()}
        onOpenQueue={vi.fn()}
      />
    </I18nProvider>
  );
}

describe("Playlist", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDefaultDownloadDir).mockResolvedValue("C:/Downloads");
    vi.mocked(api.getAvailableDiskSpace).mockResolvedValue({ available: 100 * 1024 ** 3, total: 250 * 1024 ** 3 });
    vi.mocked(api.checkHistoryDuplicates).mockResolvedValue([]);
    vi.mocked(api.enqueueDownloadBatch).mockResolvedValue({ queued: [], rejected: [] });
  });

  it.each([
    ["youtube-auth-refresh-failed", /не удалось обновить сессию YouTube/i],
    ["youtube-auth-session-unavailable", /сессия YouTube не активна/i],
  ])("explains live YouTube session errors during playlist discovery: %s", async (error, text) => {
    vi.mocked(api.probePlaylist).mockRejectedValueOnce(error);
    renderPlaylist();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByText(String(error))).not.toBeInTheDocument();
  });

  it("explains a live YouTube session failure for an individual playlist item", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValueOnce(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockResolvedValueOnce({
      entryId: "item-1", state: "requiresAuth", media: null,
      issue: { code: "authenticationRequired", message: "youtube-auth-session-unavailable", retryable: false, requiresAuth: true },
    });
    renderPlaylist();
    expect(await screen.findByText(/сессия YouTube не активна/i)).toBeInTheDocument();
  });

  it("analyzes progressively with no more than two parallel item probes", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(5));
    let active = 0;
    let maximumActive = 0;
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => window.setTimeout(resolve, 10));
      active -= 1;
      return ready(entryId);
    });

    renderPlaylist();

    expect(await screen.findByText("Тестовый плейлист", {}, { timeout: 2_000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Доступно")).toHaveLength(5), { timeout: 2_000 });
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(5);
    expect(maximumActive).toBe(2);
  });

  it("shows the sixty-second network error when playlist discovery times out", async () => {
    vi.mocked(api.probePlaylist).mockRejectedValue("analysis-error:timeout");

    renderPlaylist();

    expect(await screen.findByText(/не удалось проанализировать ссылку\. проверьте подключение/i)).toBeInTheDocument();
    expect(api.probePlaylistItem).not.toHaveBeenCalled();
  });

  it("cancels in-flight probes and resumes them in a new analysis session", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(3));
    const resolvers = new Map<string, Array<(result: PlaylistItemAnalysis) => void>>();
    vi.mocked(api.probePlaylistItem).mockImplementation((entryId) => new Promise((resolve) => {
      resolvers.set(entryId, [...(resolvers.get(entryId) ?? []), resolve]);
    }));

    renderPlaylist();
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    const firstSessionId = vi.mocked(api.beginPlaylistAnalysis).mock.calls[0][0];
    await userEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(api.cancelPlaylistAnalysis).toHaveBeenCalledWith(firstSessionId);
    await act(async () => {
      resolvers.get("item-1")?.[0]?.(ready("item-1"));
      resolvers.get("item-2")?.[0]?.(ready("item-2"));
    });

    expect(screen.queryByText("Доступно")).not.toBeInTheDocument();
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Продолжить анализ" }));
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(4));
    const beginCalls = vi.mocked(api.beginPlaylistAnalysis).mock.calls;
    const secondSessionId = beginCalls[beginCalls.length - 1]?.[0];
    expect(secondSessionId).not.toBe(firstSessionId);
    await act(async () => {
      resolvers.get("item-1")?.[1]?.(ready("item-1"));
      resolvers.get("item-2")?.[1]?.(ready("item-2"));
    });
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(5));
    await act(async () => {
      resolvers.get("item-3")?.[0]?.(ready("item-3"));
    });
    expect(await screen.findAllByText("Доступно")).toHaveLength(3);
  });

  it("warns for more than fifty items but does not impose a hard limit", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(51));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();
    expect(await screen.findByRole("dialog", { name: "Большой плейлист" }, { timeout: 2_000 })).toBeInTheDocument();
    expect(api.probePlaylistItem).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Начать анализ" }));
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(51), { timeout: 3_000 });
    await waitFor(() => expect(screen.getAllByText("Доступно")).toHaveLength(51), { timeout: 3_000 });
  });

  it("pauses remaining analysis after 429 and resumes only unfinished rows", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(3));
    const attempts = new Map<string, number>();
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => {
      const attempt = (attempts.get(entryId) ?? 0) + 1;
      attempts.set(entryId, attempt);
      if (entryId === "item-1" && attempt === 1) {
        return {
          entryId,
          state: "temporaryError",
          issue: { code: "rateLimited", message: "hidden raw message", retryable: true, requiresAuth: false },
        };
      }
      return ready(entryId);
    });

    renderPlaylist();
    expect(await screen.findByText("Анализ приостановлен", {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("hidden raw message")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.getAllByText("Доступно")).toHaveLength(3));
  });

  it("does not start a second sixty-second attempt after an item timeout", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockResolvedValue({
      entryId: "item-1",
      state: "temporaryError",
      issue: {
        code: "network",
        message: "analysis-error:timeout",
        retryable: true,
        requiresAuth: false,
      },
    });

    renderPlaylist();

    expect(await screen.findByText("Временная ошибка", {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByText(/не удалось проанализировать ссылку\. проверьте подключение/i)).toBeInTheDocument();
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(1);
  });

  it("retries only authentication-related rows after a successful sign-in", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem)
      .mockResolvedValueOnce({
        entryId: "item-1",
        state: "requiresAuth",
        issue: { code: "ageRestricted", message: "raw", retryable: false, requiresAuth: true },
      })
      .mockResolvedValueOnce(ready("item-1"));

    const view = renderPlaylist({ authenticated: false });
    expect(await screen.findByText("Требуется вход", {}, { timeout: 2_000 })).toBeInTheDocument();

    view.rerender(playlistElement({ authenticated: true }));

    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Доступно")).toBeInTheDocument();
  });

  it("retries authentication-related rows after browser cookies are enabled", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(2));
    const attempts = new Map<string, number>();
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId, _url, cookieSource) => {
      const attempt = (attempts.get(entryId) ?? 0) + 1;
      attempts.set(entryId, attempt);
      if (entryId === "item-1" && attempt === 1) {
        return {
          entryId,
          state: "requiresAuth",
          issue: { code: "authenticationRequired", message: "raw", retryable: false, requiresAuth: true },
        };
      }
      if (entryId === "item-1") {
        expect(cookieSource).toEqual({ kind: "browser", value: { browser: "firefox", profile: null } });
      }
      return ready(entryId);
    });

    const view = renderPlaylist();
    expect(await screen.findByText("Требуется вход", {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(await screen.findByText("Доступно", {}, { timeout: 2_000 })).toBeInTheDocument();

    view.rerender(playlistElement({
      authSettings: { useBrowserCookies: true, useYoutubeSession: false, browser: "firefox" },
    }));

    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(3));
    expect(await screen.findAllByText("Доступно")).toHaveLength(2);
    expect(attempts.get("item-1")).toBe(2);
    expect(attempts.get("item-2")).toBe(1);
  });

  it("counts only compatible selected rows and reports skipped rows", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(2));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => entryId === "item-1"
      ? ready(entryId)
      : {
          entryId,
          state: "requiresAuth",
          issue: { code: "authenticationRequired", message: "raw", retryable: false, requiresAuth: true },
        });
    const onJobsCreated = vi.fn();
    vi.mocked(api.enqueueDownloadBatch).mockImplementation(async (items) => ({
      queued: items.map((item, index) => ({
        clientId: item.clientId,
        job: { id: index + 1, state: "Pending", request: item.request },
      })),
      rejected: [],
    }));

    renderPlaylist({ onJobsCreated });
    const addButton = await screen.findByRole("button", { name: "Скачать выбранные (1)" }, { timeout: 2_000 });
    await waitFor(() => expect(addButton).toBeEnabled());
    await userEvent.click(addButton);

    expect(await screen.findByText("Добавлено: 1. Пропущено: 1.")).toBeInTheDocument();
    expect(api.enqueueDownloadBatch).toHaveBeenCalledWith([
      expect.objectContaining({ clientId: "item-1" }),
    ]);
    expect(onJobsCreated).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, state: "Pending" }),
    ]);
  });

  it("excludes selected videos that do not match the current quality profile from the action count", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(2));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => {
      const result = ready(entryId);
      if (entryId === "item-1" && result.media) {
        result.media.videoFormats[0] = {
          ...result.media.videoFormats[0],
          qualityLabel: "480p 30fps MP4 H.264",
          height: 480,
        };
      }
      return result;
    });

    renderPlaylist();
    const profile = await screen.findByRole("combobox", { name: "Профиль скачивания" }, { timeout: 2_000 });
    await waitFor(() => expect(screen.getAllByText("Доступно")).toHaveLength(2));
    await userEvent.click(profile);
    await userEvent.click(within(screen.getByRole("listbox", { name: "Профиль скачивания" })).getByText("480p MP4"));

    expect(await screen.findByRole("button", { name: "Скачать выбранные (1)" })).toBeEnabled();
    expect(screen.getByText("Нет формата для выбранного профиля")).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes("Выбрано: 2 из 2"))).toBeInTheDocument();
  });

  it("uses exact custom parameters and counts only matching rows in strict mode", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(2));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => {
      const result = ready(entryId);
      if (entryId === "item-1" && result.media) {
        result.media.videoFormats[0] = { ...result.media.videoFormats[0], height: 480, qualityLabel: "480p 30fps MP4 H.264" };
      }
      return result;
    });

    renderPlaylist({ formatSelectionMode: "strict" });
    await waitFor(() => expect(screen.getAllByText("Доступно")).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Дополнительно" }));
    const resolution = screen.getByRole("combobox", { name: "Разрешение" });
    await userEvent.click(resolution);
    expect(within(screen.getByRole("listbox", { name: "Разрешение" })).getAllByText("Есть у 1 из 2")).toHaveLength(2);
    await userEvent.click(within(screen.getByRole("listbox", { name: "Разрешение" })).getByText("480p"));

    expect(await screen.findByRole("button", { name: "Скачать выбранные (1)" })).toBeEnabled();
    expect(screen.getByText("Доступно по параметрам: 1 · Недоступно: 1")).toBeInTheDocument();
    expect(screen.getByText("Нет точного совпадения выбранных параметров")).toBeInTheDocument();
  });

  it("keeps fallback rows downloadable in adaptive mode and explains the adjustment on hover", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(2));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => {
      const result = ready(entryId);
      if (entryId === "item-1" && result.media) {
        result.media.videoFormats[0] = { ...result.media.videoFormats[0], height: 480, qualityLabel: "480p 30fps MP4 H.264" };
      }
      return result;
    });

    renderPlaylist({ formatSelectionMode: "adaptive" });
    await waitFor(() => expect(screen.getAllByText("Доступно")).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Дополнительно" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Разрешение" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "Разрешение" })).getByText("480p"));

    expect(await screen.findByRole("button", { name: "Скачать выбранные (2)" })).toBeEnabled();
    expect(screen.getByText("Без изменений: 1 · С изменёнными параметрами: 1 · Недоступно: 0")).toBeInTheDocument();
    expect(screen.getByText("Есть изменения")).toBeInTheDocument();
    expect(document.querySelector(".status-availableWithFallback")?.closest(".playlist-status-cell"))
      .toHaveAttribute("title", "Изменены параметры: 480p → 1080p");
    expect(screen.getByRole("img", { name: "Изменены параметры: 480p → 1080p" })).toHaveAttribute("title", "Изменены параметры: 480p → 1080p");

    await userEvent.click(screen.getByRole("combobox", { name: "Разрешение" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "Разрешение" })).getByText("Авто"));

    expect(screen.queryByText(/Без изменений:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Есть изменения")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скачать выбранные (2)" })).toBeEnabled();
  });

  it("applies adaptive matching to a named quality profile", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => {
      const result = ready(entryId);
      if (result.media) result.media.videoFormats[0] = { ...result.media.videoFormats[0], height: 360, qualityLabel: "360p 30fps MP4 H.264" };
      return result;
    });

    renderPlaylist({ formatSelectionMode: "adaptive" });
    await waitFor(() => expect(screen.getByText("Доступно")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("combobox", { name: "Профиль скачивания" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "Профиль скачивания" })).getByText("480p MP4"));

    expect(await screen.findByText("Есть изменения")).toBeInTheDocument();
    expect(screen.getByText("Без изменений: 0 · С изменёнными параметрами: 1 · Недоступно: 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скачать выбранные (1)" })).toBeEnabled();
    expect(screen.getByRole("img", { name: "Изменены параметры: 480p → 360p" })).toBeInTheDocument();
  });

  it("replaces manual video parameters when a named quality profile is selected again", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => {
      const result = ready(entryId);
      if (result.media) {
        result.media.videoFormats = [
          { ...result.media.videoFormats[0], formatId: "v-480", height: 480, fps: 30, qualityLabel: "480p 30fps MP4 H.264" },
          { ...result.media.videoFormats[0], formatId: "v-240", height: 240, fps: 60, qualityLabel: "240p 60fps MP4 H.264" },
        ];
      }
      return result;
    });

    renderPlaylist({ formatSelectionMode: "adaptive" });
    await waitFor(() => expect(screen.getByText("Доступно")).toBeInTheDocument());
    const profile = screen.getByRole("combobox", { name: "Профиль скачивания" });
    await userEvent.click(profile);
    await userEvent.click(within(screen.getByRole("listbox", { name: "Профиль скачивания" })).getByText("480p MP4"));
    await userEvent.click(screen.getByRole("button", { name: "Дополнительно" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Разрешение" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "Разрешение" })).getByText("240p"));
    await userEvent.click(screen.getByRole("combobox", { name: "FPS" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "FPS" })).getByText("60 fps"));

    expect(profile).toHaveAttribute("data-value", "custom");
    expect(screen.getByRole("combobox", { name: "Разрешение" })).toHaveAttribute("data-value", "240");
    expect(screen.getByRole("combobox", { name: "FPS" })).toHaveAttribute("data-value", "60");

    await userEvent.click(profile);
    await userEvent.click(within(screen.getByRole("listbox", { name: "Профиль скачивания" })).getByText("480p MP4"));

    expect(profile).toHaveAttribute("data-value", "mp4-480");
    expect(screen.getByRole("combobox", { name: "Разрешение" })).toHaveAttribute("data-value", "best");
    expect(screen.getByRole("combobox", { name: "FPS" })).toHaveAttribute("data-value", "auto");
    expect(screen.getByRole("combobox", { name: "Контейнер" })).toHaveAttribute("data-value", "auto");
    expect(screen.getByRole("combobox", { name: "Кодек" })).toHaveAttribute("data-value", "auto");
    expect(screen.queryByText("Есть изменения")).not.toBeInTheDocument();
    expect(screen.getByText("MP4 480p 30fps H.264 + AAC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скачать выбранные (1)" })).toBeEnabled();
  });

  it("shows a queue status only for the current mode and parameter signature", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));
    const queuedJob: Job = {
      id: 10,
      state: "Pending",
      request: {
        url: "https://youtube.com/watch?v=item-1",
        canonicalSource: "https://youtube.com/watch?v=item-1",
        title: "Видео item-1",
        preset: "bestVideo",
        formatId: "v-item-1",
        audioFormatId: "a-item-1",
        videoProfile: "best",
        videoTechnicalDetails: { height: 1080, fps: 30, codec: "avc1", requestedContainer: "mp4" },
        destinationDir: "C:/Downloads",
      },
    };

    renderPlaylist({ jobs: [queuedJob] });
    expect(await screen.findByText("В очереди", {}, { timeout: 2_000 })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Аудио" }));

    expect(await screen.findByText("Доступно")).toBeInTheDocument();
    expect(screen.queryByText("В очереди")).not.toBeInTheDocument();
  });

  it("provides separate paste and clear actions for the playlist URL", async () => {
    const onUrlChange = vi.fn();
    renderPlaylist({ onUrlChange });

    const input = screen.getByRole("textbox", { name: "Ссылка на плейлист" });
    const pasteButton = screen.getByRole("button", { name: "Вставить ссылку из буфера обмена" });
    const clearButton = screen.getByRole("button", { name: "Очистить" });
    expect(input.closest(".url-row")).not.toBeNull();
    expect(input).toHaveAttribute("data-has-url", "true");
    expect(pasteButton).toHaveClass("url-action-button", "url-paste-button");
    expect(pasteButton).toHaveTextContent("Вставить");
    expect(clearButton).toHaveClass("url-action-button", "url-clear-button");

    await userEvent.click(clearButton);

    expect(onUrlChange).toHaveBeenCalledWith("");
    expect(pasteButton).toBeInTheDocument();
  });

  it("updates flat playlist thumbnails from progressive item analysis", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();

    const thumbnail = await screen.findByAltText("Видео item-1", {}, { timeout: 2_000 });
    expect(thumbnail).toHaveAttribute("src", "https://i.ytimg.com/vi/item-1/hqdefault.jpg");
  });

  it("shows the selected size and free space out of the destination disk total", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();

    await waitFor(() => expect(api.getAvailableDiskSpace).toHaveBeenCalledWith("C:/Downloads"), { timeout: 2_000 });
    expect(await screen.findByText((text) => text.includes("Выбрано: 1 из 1") && text.includes("Свободно на диске: 100 ГБ из 250 ГБ"))).toBeInTheDocument();
  });

  it("resizes only the column whose handle is dragged in both playlist layouts", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();
    await screen.findByText("Тестовый плейлист", {}, { timeout: 2_000 });

    async function verifyCurrentLayout(expectedWidths: number[]) {
      expect(document.querySelectorAll<HTMLElement>(".column-resizer")).toHaveLength(4);

      for (let index = 0; index < expectedWidths.length; index += 1) {
        const handles = document.querySelectorAll<HTMLElement>(".column-resizer");
        fireEvent.mouseDown(handles[index], { button: 0, clientX: 100 });
        fireEvent.mouseMove(document, { clientX: 120 });
        fireEvent.mouseUp(document);
        expectedWidths[index] += 20;

        await waitFor(() => {
          const template = document.querySelector<HTMLElement>(".playlist-table-head")?.style.gridTemplateColumns;
          expect(template).toBe(`42px ${expectedWidths.map((width) => `${width}px`).join(" ")}`);
        });
      }
    }

    await verifyCurrentLayout([370, 78, 96, 140]);
    await userEvent.click(screen.getByRole("button", { name: "Показать список сверху" }));
    expect(document.querySelector<HTMLElement>(".playlist-table-wrap")).toHaveClass("compact");
    await verifyCurrentLayout([370, 78, 96, 140]);

    const titleHandle = document.querySelectorAll<HTMLElement>(".column-resizer")[0];
    fireEvent.mouseDown(titleHandle, { button: 0, clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 40 });
    fireEvent.mouseUp(document);
    await waitFor(() => {
      expect(document.querySelector<HTMLElement>(".playlist-table-head")?.style.gridTemplateColumns)
        .toBe("42px 330px 98px 116px 160px");
      expect(document.querySelector<HTMLElement>(".playlist-table")).toHaveStyle({ width: "746px" });
    });
  });

  it("fills the available table width on first display and still allows the title to shrink", async () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1150);
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    try {
      renderPlaylist();
      await screen.findByText("Тестовый плейлист", {}, { timeout: 2_000 });
      await waitFor(() => expect(document.querySelector<HTMLElement>(".playlist-table-head")?.style.gridTemplateColumns)
        .toBe("42px 794px 78px 96px 140px"));
      expect(document.querySelector<HTMLElement>(".playlist-table")).toHaveStyle({ width: "1150px" });

      await userEvent.click(screen.getByRole("button", { name: "Показать список сверху" }));
      await waitFor(() => expect(document.querySelector<HTMLElement>(".playlist-table-head")?.style.gridTemplateColumns)
        .toBe("42px 794px 78px 96px 140px"));

      const titleHandle = document.querySelectorAll<HTMLElement>(".column-resizer")[0];
      fireEvent.mouseDown(titleHandle, { button: 0, clientX: 200 });
      fireEvent.mouseMove(document, { clientX: 100 });
      fireEvent.mouseUp(document);
      await waitFor(() => expect(document.querySelector<HTMLElement>(".playlist-table-head")?.style.gridTemplateColumns)
        .toBe("42px 694px 78px 96px 140px"));
    } finally {
      clientWidth.mockRestore();
    }
  });

  it("resizes every data column when the list is shown above the parameters", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();
    await screen.findByText("Тестовый плейлист", {}, { timeout: 2_000 });
    await userEvent.click(screen.getByRole("button", { name: "Показать список сверху" }));

    const handles = document.querySelectorAll<HTMLElement>(".column-resizer");
    expect(handles).toHaveLength(4);
    fireEvent.mouseDown(handles[3], { button: 0, clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 140 });
    fireEvent.mouseUp(document);
    await waitFor(() => expect(document.querySelector<HTMLElement>(".playlist-table-head")?.style.gridTemplateColumns).toContain("180px"));
    const statusDetail = document.querySelector<HTMLElement>(".playlist-status-cell > small");
    expect(statusDetail).not.toBeNull();
    expect(statusDetail!.getAttribute("title")).toBe(statusDetail!.textContent);
  });

  it("uses the same mode controls and quality-profile presentation as New download", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();
    const profile = await screen.findByRole("combobox", { name: "Профиль скачивания" }, { timeout: 2_000 });
    expect(document.querySelectorAll(".mode-tab .mode-tab-icon")).toHaveLength(3);
    expect(profile).toHaveTextContent("Автоматический выбор наилучшего доступного формата");
    expect(profile.querySelector(".parameter-select-icon")).toBeInTheDocument();

    await userEvent.click(profile);
    const menu = screen.getByRole("listbox", { name: "Профиль скачивания" });
    expect(within(menu).getByText("По качеству")).toBeInTheDocument();
    expect(within(menu).getByText("Для устройств")).toBeInTheDocument();
    expect(within(menu).getByText("Отличное качество для Full HD экранов")).toBeInTheDocument();
    expect(menu.querySelector('[data-value="mp4-1080"] .parameter-select-icon')).toBeInTheDocument();
  });

  it("uses the shared download action and click animation", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();
    const button = await screen.findByRole("button", { name: "Скачать выбранные (1)" }, { timeout: 2_000 });
    expect(button).toHaveClass("download-action", "playlist-enqueue-button");
    expect(button).toHaveAttribute("data-analyzed", "true");
    expect(button.querySelector(".download-action-icon")).toBeInTheDocument();

    await userEvent.click(button);

    expect(button).toHaveAttribute("data-animating", "true");
  });

  it("selects and clears a continuous range by dragging across rows", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(3));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3), { timeout: 2_000 });
    const rowCheckboxes = screen.getAllByRole("checkbox");

    fireEvent.mouseDown(rowCheckboxes[0], { button: 0 });
    fireEvent.mouseEnter(rowCheckboxes[2]);
    fireEvent.mouseUp(document);

    await waitFor(() => rowCheckboxes.forEach((row) => expect(row).toHaveAttribute("aria-checked", "false")));
  });

  it("restores the starting row when drag selection returns to its anchor", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(3));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(3), { timeout: 2_000 });
    const rows = screen.getAllByRole("checkbox");

    fireEvent.mouseDown(rows[0], { button: 0 });
    fireEvent.mouseEnter(rows[2]);
    fireEvent.mouseEnter(rows[0]);
    fireEvent.mouseUp(document);

    await waitFor(() => rows.forEach((row) => expect(row).toHaveAttribute("aria-checked", "true")));

    await userEvent.click(screen.getByRole("button", { name: "Снять выбор со всех объектов" }));
    fireEvent.mouseDown(rows[0], { button: 0 });
    fireEvent.mouseEnter(rows[2]);
    fireEvent.mouseEnter(rows[0]);
    fireEvent.mouseUp(document);

    await waitFor(() => rows.forEach((row) => expect(row).toHaveAttribute("aria-checked", "false")));
  });

  it("keeps audio parameters aligned and places both toggles in one list", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));

    renderPlaylist();
    await userEvent.click(await screen.findByRole("tab", { name: "Аудио" }, { timeout: 2_000 }));

    expect(document.querySelectorAll(".playlist-audio-settings-grid .playlist-param")).toHaveLength(3);
    expect(document.querySelectorAll(".playlist-audio-settings .playlist-toggle-list .switch-row")).toHaveLength(2);
  });

  it("hides playlist enqueue feedback ten seconds after the latest successful batch", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));
    vi.mocked(api.enqueueDownloadBatch).mockImplementation(async (items) => ({
      queued: items.map((item, index) => ({
        clientId: item.clientId,
        job: { id: index + 1, state: "Pending", request: item.request },
      })),
      rejected: [],
    }));
    renderPlaylist();
    const button = await screen.findByRole("button", { name: "Скачать выбранные (1)" }, { timeout: 2_000 });
    await waitFor(() => expect(button).toBeEnabled());
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(button); });
    expect(screen.getByText("Добавлено: 1. Пропущено: 0.")).toBeInTheDocument();
    const countdown = document.querySelector(".playlist-batch-feedback svg");
    expect(countdown).toHaveAttribute("aria-hidden", "true");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await act(async () => { fireEvent.click(button); });
    expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".playlist-batch-feedback svg")).not.toBe(countdown);
    await act(async () => vi.advanceTimersByTimeAsync(9_999));
    expect(screen.getByText("Добавлено: 1. Пропущено: 0.")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByText("Добавлено: 1. Пропущено: 0.")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("shows an alert beside the action when an active queue duplicate is skipped", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));
    vi.mocked(api.enqueueDownloadBatch).mockResolvedValue({
      queued: [],
      rejected: [{ clientId: "item-1", code: "enqueue-error:duplicate-video" }],
    });

    renderPlaylist();
    const button = await screen.findByRole("button", { name: "Скачать выбранные (1)" }, { timeout: 2_000 });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    const feedback = await screen.findByRole("alert");
    expect(feedback.querySelector(".notice-countdown")).toBeNull();
    expect(feedback).toHaveTextContent("Не все объекты добавлены");
    expect(feedback).toHaveTextContent("Добавлено: 0. Пропущено: 1.");
    expect(screen.getByText("Видео с этими параметрами уже находится в Очереди загрузок")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Закрыть уведомление о добавлении в очередь" }));
    expect(feedback).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Добавлено: 0. Пропущено: 1.");
  });
});
