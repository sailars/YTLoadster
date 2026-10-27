import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import type { Job, MediaInfo, PlaylistInfo, PlaylistItemAnalysis } from "../lib/types";
import { api } from "../lib/api";
import { Playlist } from "./Playlist";
import { defaultPlaylistParameters, resolvePlaylistItem } from "../lib/playlistModel";
import type { CollectionWorkspace } from "../lib/workspace";
import "../styles.css";

vi.mock("../lib/api", () => ({
  api: {
    previewAlbumDestination: vi.fn().mockImplementation(async (base, artist, album, enabled) => enabled ? `${base}/${artist} - ${album}` : base),
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

function renderMusicCollection(locale: "ru" | "en" = "ru") {
  return render(<I18nProvider locale={locale}><Playlist musicMode audioEncoders={["aac", "libopus", "flac"]} url="https://music.youtube.com/playlist?list=PL-music" sourceIsPlaylist authSettings={authSettings} authenticated={false} includeVideoTechnicalDetailsInFilename={false} formatSelectionMode="strict" jobs={[]} downloadedHistoryKeys={new Set()} onUrlChange={vi.fn()} onJobsCreated={vi.fn()} onOpenQueue={vi.fn()} /></I18nProvider>);
}

function renderPlaylist(options: {
  initialWorkspace?: CollectionWorkspace;
  musicMode?: boolean;
  settingsResetVersion?: number;
  defaultDestinationDir?: string;
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
  initialWorkspace?: CollectionWorkspace;
  musicMode?: boolean;
  settingsResetVersion?: number;
  defaultDestinationDir?: string;
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
        musicMode={options.musicMode}
        initialWorkspace={options.initialWorkspace}
        settingsResetVersion={options.settingsResetVersion}
        defaultDestinationDir={options.defaultDestinationDir}
        url="https://youtube.com/playlist?list=PL-test"
        sourceIsPlaylist
        authSettings={options.authSettings ?? authSettings}
        authenticated={options.authenticated ?? false}
        includeVideoTechnicalDetailsInFilename={false}
        formatSelectionMode={options.formatSelectionMode ?? "strict"}
        jobs={options.jobs ?? []}
        downloadedHistoryKeys={new Set()}
        onUrlChange={options.onUrlChange ?? vi.fn()}
        onJobsCreated={options.onJobsCreated ?? vi.fn()}
        onOpenQueue={vi.fn()}
      />
    </I18nProvider>
  );
}

describe("Playlist", () => {
  it("shows saved album fields even when every restored song is still pending", async () => {
    const info = { ...playlistInfo(2), musicKind: "album" as const };
    const saved: CollectionWorkspace = {
      kind: "collection", url: "https://youtube.com/playlist?list=PL-test", playlist: info,
      rows: info.entries.map((entry) => ({ entry, selected: entry.index !== 2, analysisState: "pending", media: null })),
      params: { ...defaultPlaylistParameters, musicMode: true, mode: "audio", audioPreset: "audioSource", destinationDir: "saved-target" },
      musicEdits: {}, albumEdits: { albumArtist: "Saved artist", album: "Saved album", year: "2026" }, createAlbumFolder: false, layout: "wide",
    };
    vi.mocked(api.probePlaylistItem).mockImplementation(async (id) => ready(id));
    render(<StrictMode>{playlistElement({ musicMode: true, initialWorkspace: saved })}</StrictMode>);
    expect(screen.getByRole("checkbox", { name: /Видео 2$/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("textbox", { name: "Исполнитель альбома" })).toHaveValue("Saved artist");
    expect(screen.getByRole("textbox", { name: "Альбом" })).toHaveValue("Saved album");
    expect(screen.getByRole("textbox", { name: "Год" })).toHaveValue("2026");
    expect(screen.getByRole("checkbox", { name: "Создавать папку альбома" })).not.toBeChecked();
    expect(api.probePlaylist).not.toHaveBeenCalled();
    expect(api.probePlaylistItem).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("checkbox", { name: /Видео 2$/ })).getByRole("button", { name: "Проанализировать: Видео 2" }));
    await screen.findByText("Анализ: 1 из 2");
    expect(screen.getByRole("checkbox", { name: /Видео item-2$/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("textbox", { name: "Альбом" })).toHaveValue("Saved album");
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(1);
  });
  it.each(["playlist", "stacked", "music"])("filters title and artist while retaining hidden selections in %s", async (layout) => {
    const titles = ["Ёлка", "Белый свет", "Ночь"];
    const artists = ["Мумий Тролль", "Lumi Elara", "Beyoncé"];
    const info = playlistInfo(3);
    info.entries.forEach((entry, index) => { entry.title = titles[index]; });
    vi.mocked(api.probePlaylist).mockResolvedValue(info);
    vi.mocked(api.probePlaylistItem).mockImplementation(async (id) => {
      const index = Number(id.match(/item-(\d+)$/)?.[1]) - 1;
      return { entryId: id, state: "ready", media: { ...media(id), title: titles[index], uploader: artists[index],
        music: { title: titles[index], artist: artists[index], album: "Album", albumArtist: "Artists", year: "2026", trackNumber: index + 1 } } };
    });
    if (layout === "music") renderMusicCollection(); else renderPlaylist();
    await screen.findByText("Анализ: 3 из 3", {}, { timeout: 3_000 });
    if (layout === "stacked") await userEvent.click(screen.getByRole("button", { name: "Показать список сверху" }));
    const search = screen.getByRole("searchbox", { name: "Поиск по названию и исполнителю" });
    fireEvent.change(search, { target: { value: "СВЕТ elara" } });
    expect(document.querySelectorAll(".playlist-table-row")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /Белый свет/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("1 из 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole(layout === "music" ? "checkbox" : "button", { name: layout === "music" ? "Выбрать все треки" : "Снять выбор со всех объектов" }));
    await userEvent.click(screen.getByRole("button", { name: "Очистить поиск" }));
    expect(document.querySelectorAll(".playlist-table-row")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: /Ёлка/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: /Белый свет/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: /Ночь/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(search, { target: { value: "не существует" } });
    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(screen.queryByText("Ничего не найдено")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Скачать выбранные (2)" }));
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.enqueueDownloadBatch).mock.calls[0][0].map((item) => item.clientId)).toEqual(layout === "music" ? ["0:item-1", "2:item-3"] : ["item-1", "item-3"]);
    expect(api.probePlaylist).toHaveBeenCalledTimes(1);
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(3);
    expect(api.cancelPlaylistAnalysis).not.toHaveBeenCalled();
  });
  it("excludes an active exact download from ready candidates while analyzing the remaining rows", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(2));
    let finish!: (value: PlaylistItemAnalysis) => void;
    vi.mocked(api.probePlaylistItem).mockImplementation(async (id) => id === "item-1" ? ready(id)
      : new Promise((resolve) => { finish = resolve; }));
    const request = resolvePlaylistItem(media("item-1"), { ...defaultPlaylistParameters, destinationDir: "C:/Downloads" }, "https://youtube.com/watch?v=item-1", null).request!;
    renderPlaylist({ jobs: [{ id: 1, state: "Running", request }] });
    await screen.findByText("Анализ: 1 из 2", {}, { timeout: 3_000 });
    expect(screen.getByRole("button", { name: "Скачать готовые (0)" })).toBeDisabled();
    await act(async () => finish(ready("item-2")));
    await userEvent.click(screen.getByRole("button", { name: "Скачать выбранные (1)" }));
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.enqueueDownloadBatch).mock.calls[0][0].map((item) => item.clientId)).toEqual(["item-2"]);
  });
  it.each(["playlist", "stacked", "music"])("downloads selected ready entries without interrupting analysis in %s", async (layout) => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(3));
    const pending = new Map<string, (value: PlaylistItemAnalysis) => void>();
    vi.mocked(api.probePlaylistItem).mockImplementation(async (id) => id.endsWith("item-1") ? ready(id)
      : new Promise((resolve) => pending.set(id, resolve)));
    vi.mocked(api.enqueueDownloadBatch).mockImplementationOnce(async (items) => ({
      queued: items.map((item, index) => ({ clientId: item.clientId, job: { id: index + 1, state: "Pending", request: item.request } })), rejected: [],
    }));
    if (layout === "music") renderMusicCollection(); else renderPlaylist();
    if (layout === "stacked") await userEvent.click(await screen.findByRole("button", { name: "Показать список сверху" }, { timeout: 3_000 }));
    const action = await screen.findByRole("button", { name: "Скачать готовые (1)" }, { timeout: 3_000 });
    await waitFor(() => expect(action).toBeEnabled());
    await userEvent.click(action);
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.enqueueDownloadBatch).mock.calls[0][0]).toHaveLength(1);
    expect(vi.mocked(api.enqueueDownloadBatch).mock.calls[0][0][0].clientId).toMatch(/item-1$/);
    expect(api.cancelPlaylistAnalysis).not.toHaveBeenCalled();
    expect(screen.getByText("Анализ: 1 из 3")).toBeInTheDocument();
    expect(screen.queryByText(/Пропущено: [1-9]/)).not.toBeInTheDocument();
    await waitFor(() => expect(pending.size).toBe(2));
    await act(async () => pending.forEach((resolve, id) => resolve(ready(id))));
    await screen.findByText("Анализ: 3 из 3");
  });

  it.each([false, true])("restores collection data and selection with unfinished analysis paused, music=%s", async (music) => {
    const info = { ...playlistInfo(2), ...(music ? { musicKind: "album" as const } : {}) };
    const saved: CollectionWorkspace = {
      kind: "collection", url: "https://youtube.com/playlist?list=PL-test", playlist: info,
      rows: [{ entry: info.entries[0], selected: false, analysisState: "ready", media: media("item-1") },
        { entry: info.entries[1], selected: true, analysisState: "pending", media: null }],
      params: { ...defaultPlaylistParameters, mode: "audio", destinationDir: "saved-target" },
      musicEdits: music ? { "item-1": { title: "Saved song", artist: "Saved artist" } } : {},
      albumEdits: music ? { album: "Saved album" } : {}, createAlbumFolder: false, layout: "wide",
    };
    vi.mocked(api.probePlaylistItem).mockImplementation(async (id) => ready(id));
    render(<StrictMode>{playlistElement({ initialWorkspace: saved, musicMode: music })}</StrictMode>);
    expect(screen.getByText("Анализ: 1 из 2")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: music ? "Трек" : "Аудио" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Папка загрузки" })).toHaveValue("saved-target");
    expect(screen.getByRole("checkbox", { name: music ? /Saved song/ : /Видео 1/ })).toHaveAttribute("aria-checked", "false");
    if (music) expect(screen.getByRole("textbox", { name: "Альбом" })).toHaveValue("Saved album");
    expect(api.probePlaylist).not.toHaveBeenCalled();
    expect(api.probePlaylistItem).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Продолжить анализ" }));
    await screen.findByText("Анализ: 2 из 2");
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(1);
  });
  it("resets open download options without replacing analyzed entries or their selection", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(2));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (id) => ready(id));
    const view = renderPlaylist({ defaultDestinationDir: "old-downloads" });
    await screen.findByText("Анализ: 2 из 2", {}, { timeout: 3_000 });
    await userEvent.click(screen.getByRole("tab", { name: "Аудио" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Встраивать метаданные" }));
    view.rerender(playlistElement({ settingsResetVersion: 1, defaultDestinationDir: "new-downloads" }));
    expect(screen.getByRole("tab", { name: "Видео" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Анализ: 2 из 2")).toBeInTheDocument();
    expect(api.probePlaylist).toHaveBeenCalledTimes(1);
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Скачать выбранные (2)" }));
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.enqueueDownloadBatch).mock.calls[0][0]).toEqual([
      expect.objectContaining({ request: expect.objectContaining({ preset: "bestVideo", destinationDir: "new-downloads" }) }),
      expect.objectContaining({ request: expect.objectContaining({ preset: "bestVideo", destinationDir: "new-downloads" }) }),
    ]);
  });
  it.each([false, true])("offers only relevant duplicate actions, music=%s", async (music) => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(2));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (id) => ready(id));
    vi.mocked(api.checkHistoryDuplicates).mockImplementation(async (items) => items.map((item) => ({ clientId: item.clientId, historyId: item.clientId })));
    if (music) renderMusicCollection(); else renderPlaylist();
    const download = await screen.findByRole("button", { name: "Скачать выбранные (2)" }, { timeout: 3_000 });
    await waitFor(() => expect(download).toBeEnabled());
    await userEvent.click(download);
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Все выбранные файлы уже загружались");
    expect(within(dialog).queryByRole("button", { name: "Скачать только новые" })).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole("button", { name: "Скачать все выбранные" }));
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.enqueueDownloadBatch).mock.calls[0][0]).toHaveLength(2);
    vi.mocked(api.checkHistoryDuplicates).mockImplementation(async (items) => [{ clientId: items[0].clientId, historyId: "existing" }]);
    await userEvent.click(download);
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Часть файлов уже загружалась");
    await userEvent.click(within(dialog).getByRole("button", { name: "Скачать только новые" }));
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(2));
    const candidates = vi.mocked(api.checkHistoryDuplicates).mock.calls[1][0];
    expect(vi.mocked(api.enqueueDownloadBatch).mock.calls[1][0].map((item) => item.clientId)).toEqual([candidates[1].clientId]);
  });

  it("applies the album folder option to a one-track album and preserves it in clip mode", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue({ ...playlistInfo(1), musicKind: "album" });
    vi.mocked(api.probePlaylistItem).mockImplementation(async (id) => ready(id));
    const save = vi.fn().mockResolvedValue(true);
    render(<I18nProvider locale="ru"><Playlist musicMode musicAlbumFolder onMusicAlbumFolderChange={save} audioEncoders={["aac"]} url="https://music.youtube.com/playlist?list=OLAK5uy_album" sourceIsPlaylist authSettings={authSettings} authenticated={false} includeVideoTechnicalDetailsInFilename={false} formatSelectionMode="strict" jobs={[]} downloadedHistoryKeys={new Set()} onUrlChange={vi.fn()} onJobsCreated={vi.fn()} onOpenQueue={vi.fn()} /></I18nProvider>);
    const toggle = await screen.findByRole("checkbox", { name: "Создавать папку альбома" }, { timeout: 3_000 });
    expect(toggle).toBeChecked();
    expect(toggle.closest(".music-tags")).toHaveAccessibleName("Метаданные");
    await userEvent.click(toggle);
    await waitFor(() => expect(save).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.getByLabelText("Итоговая папка")).toHaveTextContent("C:/Downloads"));
    await userEvent.click(screen.getByRole("button", { name: "Скачать выбранные (1)" }));
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.enqueueDownloadBatch).mock.calls[0][0][0].request.music).toMatchObject({ collectionKind: "album", createAlbumFolder: false, metadata: { trackNumber: 1 } });
    await userEvent.click(screen.getByRole("tab", { name: "Клип" }));
    expect(screen.getByRole("checkbox", { name: "Создавать папку альбома" })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Скачать выбранные (1)" }));
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.enqueueDownloadBatch).mock.calls[1][0][0].request.music?.createAlbumFolder).toBe(false);
  });

  it("restores the folder choice when saving the preference fails", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue({ ...playlistInfo(1), musicKind: "album" });
    vi.mocked(api.probePlaylistItem).mockImplementation(async (id) => ready(id));
    render(<I18nProvider locale="en"><Playlist musicMode onMusicAlbumFolderChange={vi.fn().mockResolvedValue(false)} audioEncoders={["aac"]} url="https://music.youtube.com/playlist?list=OLAK5uy_album" sourceIsPlaylist authSettings={authSettings} authenticated={false} includeVideoTechnicalDetailsInFilename={false} formatSelectionMode="strict" jobs={[]} downloadedHistoryKeys={new Set()} onUrlChange={vi.fn()} onJobsCreated={vi.fn()} onOpenQueue={vi.fn()} /></I18nProvider>);
    const toggle = await screen.findByRole("checkbox", { name: "Create album folder" }, { timeout: 3_000 });
    await userEvent.click(toggle);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the folder preference.");
    expect(toggle).toBeChecked();
  });

  it.each([false, true])("sorts every column without changing row identity or range selection, music=%s", async (music) => {
    const titles = ["Яркий", "Альфа", "Бета", "Гамма"];
    const durations = [100, 20, 60];
    const sizes = [100_000, 300_000, 200_000];
    const info = playlistInfo(4);
    info.entries = info.entries.map((entry, index) => ({ ...entry, title: titles[index], duration: null }));
    vi.mocked(api.probePlaylist).mockResolvedValue(info);
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => {
      const index = Number(entryId.split("item-")[1]) - 1;
      if (index === 3) return { entryId, state: "temporaryError", issue: { code: "network", message: "offline", retryable: true, requiresAuth: false } };
      const item = media(entryId);
      return { entryId, state: "ready", media: { ...item, title: titles[index], duration: durations[index], videoFormats: item.videoFormats.map((format) => ({ ...format, filesize: sizes[index] })), audioFormats: item.audioFormats.map((format) => ({ ...format, filesize: sizes[index] })) } };
    });
    if (music) renderMusicCollection(); else renderPlaylist();
    await waitFor(() => expect(screen.getByText("Анализ: 4 из 4")).toBeInTheDocument(), { timeout: 3_000 });
    const rowTitles = () => Array.from(document.querySelectorAll(".playlist-table-body .playlist-row-title strong"), (node) => node.textContent);
    const header = music ? "Трек / Исполнитель" : "Название";
    await userEvent.click(screen.getByRole("button", { name: `${header}: По алфавиту от А до Я` }));
    expect(rowTitles()).toEqual(["Альфа", "Бета", "Гамма", "Яркий"]);
    const displayRows = document.querySelectorAll(".playlist-table-row");
    fireEvent.mouseDown(displayRows[0], { button: 0 });
    fireEvent.mouseEnter(displayRows[1]);
    fireEvent.mouseUp(document);
    expect(screen.getByRole("checkbox", { name: /Альфа/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: /Бета/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: /Яркий/ })).toHaveAttribute("aria-checked", "true");
    const handle = document.querySelector(".column-resizer")!;
    fireEvent.mouseDown(handle, { button: 0, clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 120 });
    fireEvent.mouseUp(document);
    expect(rowTitles()).toEqual(["Альфа", "Бета", "Гамма", "Яркий"]);
    await userEvent.click(screen.getByRole("button", { name: `${header}: По алфавиту от Я до А` }));
    expect(rowTitles()).toEqual(["Яркий", "Гамма", "Бета", "Альфа"]);
    await userEvent.click(screen.getByRole("button", { name: `${header}: Вернуть исходный порядок` }));
    expect(rowTitles()).toEqual(titles);
    for (const [column, ascending, descending] of [
      ["Длит.", ["Альфа", "Бета", "Яркий", "Гамма"], ["Яркий", "Бета", "Альфа", "Гамма"]],
      ["Размер", ["Яркий", "Бета", "Альфа", "Гамма"], ["Альфа", "Бета", "Яркий", "Гамма"]],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: `${column}: По возрастанию` }));
      expect(rowTitles()).toEqual(ascending);
      await userEvent.click(screen.getByRole("button", { name: `${column}: По убыванию` }));
      expect(rowTitles()).toEqual(descending);
    }
    await userEvent.click(screen.getByRole("button", { name: "Статус: От лучших статусов к худшим" }));
    expect(rowTitles()).toEqual(titles);
    await userEvent.click(screen.getByRole("button", { name: "Статус: От худших статусов к лучшим" }));
    expect(rowTitles()).toEqual(["Гамма", "Яркий", "Альфа", "Бета"]);
    if (!music) {
      await userEvent.click(screen.getByRole("button", { name: "Показать список сверху" }));
      expect(rowTitles()).toEqual(["Гамма", "Яркий", "Альфа", "Бета"]);
    }
  });

  it.each([[false, true], [true, true], [false, false], [true, false]])("resumes only unfinished rows after rate limiting without waiting for cancelled workers, music=%s individual=%s", async (music, individual) => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(5));
    const oldRequests: Array<{ id: string; finish: (result: PlaylistItemAnalysis) => void }> = [];
    const initialSessions = new Set<string>();
    let resumed = false;
    const limited = (entryId: string): PlaylistItemAnalysis => ({ entryId, state: "temporaryError", media: null, issue: { code: "rateLimited", message: "429", retryable: true, requiresAuth: false } });
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId, _url, _cookie, session) => {
      if (session.includes("playlist-item-")) return limited(entryId);
      if (resumed || entryId.endsWith("item-1")) return ready(entryId);
      initialSessions.add(session);
      return new Promise((finish) => { oldRequests.push({ id: entryId, finish }); });
    });
    if (music) renderMusicCollection(); else renderPlaylist();
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(3), { timeout: 2_000 });
    if (individual) {
      await userEvent.click(screen.getByRole("button", { name: "Остановить" }));
      await userEvent.click(screen.getByRole("button", { name: "Проанализировать: Видео 5" }));
    } else {
      await act(async () => oldRequests.find((request) => request.id.endsWith("item-2"))!.finish(limited(oldRequests.find((request) => request.id.endsWith("item-2"))!.id)));
    }
    expect(await screen.findByText("Анализ приостановлен")).toBeInTheDocument();
    const completedId = vi.mocked(api.probePlaylistItem).mock.calls.find((call) => call[0].endsWith("item-1"))![0];
    resumed = true;
    await userEvent.click(screen.getByRole("button", { name: /^Продолжить$/ }));
    await waitFor(() => expect(screen.getByText("Анализ: 5 из 5")).toBeInTheDocument(), { timeout: 2_000 });
    expect(screen.getAllByText("Доступно")).toHaveLength(5);
    expect(api.probePlaylist).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.probePlaylistItem).mock.calls.filter((call) => call[0] === completedId)).toHaveLength(1);
    const restarted = vi.mocked(api.probePlaylistItem).mock.calls.filter((call) => !initialSessions.has(call[3]) && !call[3].includes("playlist-item-") && call[0] !== completedId);
    expect(restarted).toHaveLength(4);
    await act(async () => oldRequests.forEach(({ id, finish }) => finish({ ...ready(id), media: { ...media(id), title: "STALE" } })));
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
    expect(screen.queryByText("Анализ приостановлен")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Анализируется" })).not.toBeInTheDocument();
  });

  it.each([false, true])("analyzes a stopped regular playlist item below its status, including retry, stacked=%s", async (stacked) => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(3));
    let finishItem!: (result: PlaylistItemAnalysis) => void;
    let attempts = 0;
    vi.mocked(api.probePlaylistItem).mockImplementation((entryId, _url, _cookies, session) => {
      if (!session.startsWith("playlist-item-")) return new Promise(() => {});
      attempts += 1;
      if (attempts === 1) return Promise.resolve({ entryId, state: "temporaryError", issue: { code: "network", message: "offline", retryable: true, requiresAuth: false } });
      return new Promise((resolve) => { finishItem = resolve; });
    });
    renderPlaylist();
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    await userEvent.click(screen.getByRole("button", { name: "Остановить" }));
    if (stacked) await userEvent.click(screen.getByRole("button", { name: "Показать список сверху" }));
    const row = screen.getByRole("checkbox", { name: /Видео 3/ });
    const action = within(row).getByRole("button", { name: "Проанализировать: Видео 3" });
    expect(action.closest(".playlist-status-cell")).not.toBeNull();
    expect(within(row.querySelector(".playlist-row-title")!).queryByRole("button", { name: /Проанализировать/ })).not.toBeInTheDocument();
    await userEvent.click(action);
    const retry = await within(row).findByRole("button", { name: "Проанализировать: Видео 3" });
    expect(retry).toBeEnabled();
    expect(retry).toHaveAttribute("title", expect.stringContaining("Проанализировать:"));
    await userEvent.click(retry);
    expect(within(row).getByRole("status", { name: "Анализируется" })).toHaveAttribute("aria-busy", "true");
    expect(within(row).queryByRole("button", { name: /Проанализировать/ })).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent("Анализируется");
    expect(row).toHaveAttribute("aria-checked", "true");
    expect(row.querySelectorAll(".analysis-spinner")).toHaveLength(1);
    await waitFor(() => expect(attempts).toBe(2));
    await act(async () => finishItem(ready("item-3")));
    expect(within(row).queryByRole("button", { name: /Проанализировать/ })).not.toBeInTheDocument();
    expect(screen.getByText("Анализ: 1 из 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продолжить анализ" })).toBeInTheDocument();
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(4);
  });

  it.each(["ru", "en"] as const)("commits metadata with Done and discards edits and resets with Cancel in %s", async (locale) => {
    vi.mocked(api.probePlaylist).mockResolvedValue({ ...playlistInfo(1), musicKind: "playlist" });
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));
    renderMusicCollection(locale);
    const labels = locale === "ru"
      ? { metadata: "Метаданные", edit: "Редактировать теги", title: "Название", done: "Готово", cancel: "Отмена", reset: "Восстановить исходные теги" }
      : { metadata: "Metadata", edit: "Edit tags", title: "Title", done: "Done", cancel: "Cancel", reset: "Restore source tags" };
    const originalTitle = "Видео 0:item-1";
    await userEvent.click(await screen.findByRole("button", { name: `${labels.edit}: ${originalTitle}` }, { timeout: 2_000 }));
    let dialog = within(screen.getByRole("dialog", { name: labels.metadata }));
    expect(dialog.getByRole("heading", { name: labels.metadata })).toBeInTheDocument();
    fireEvent.change(dialog.getByRole("textbox", { name: labels.title }), { target: { value: "Saved title" } });
    expect(screen.getByRole("checkbox", { name: new RegExp(originalTitle) })).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: labels.done }));
    expect(screen.getByRole("checkbox", { name: /Saved title/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: `${labels.edit}: Saved title` }));
    dialog = within(screen.getByRole("dialog", { name: labels.metadata }));
    fireEvent.change(dialog.getByRole("textbox", { name: labels.title }), { target: { value: "Discarded title" } });
    await userEvent.click(dialog.getByRole("button", { name: labels.cancel }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Saved title/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: `${labels.edit}: Saved title` }));
    dialog = within(screen.getByRole("dialog", { name: labels.metadata }));
    expect(dialog.getByRole("textbox", { name: labels.title })).toHaveValue("Saved title");
    await userEvent.click(dialog.getByRole("button", { name: labels.reset }));
    expect(dialog.getByRole("textbox", { name: labels.title })).toHaveValue(originalTitle);
    await userEvent.click(dialog.getByRole("button", { name: labels.cancel }));
    expect(screen.getByRole("checkbox", { name: /Saved title/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: `${labels.edit}: Saved title` }));
    dialog = within(screen.getByRole("dialog", { name: labels.metadata }));
    await userEvent.click(dialog.getByRole("button", { name: labels.reset }));
    await userEvent.click(dialog.getByRole("button", { name: labels.done }));
    expect(screen.getByRole("checkbox", { name: new RegExp(originalTitle) })).toBeInTheDocument();
  });

  it.each([false, true])("analyzes only a requested music row while bulk analysis stays stopped, clip=%s", async (clip) => {
    vi.mocked(api.probePlaylist).mockResolvedValue({ ...playlistInfo(5), musicKind: "playlist" });
    let finishItem!: (result: PlaylistItemAnalysis) => void;
    vi.mocked(api.probePlaylistItem).mockImplementation((entryId, _url, _cookies, session) => {
      if (session.startsWith("music-playlist-item-")) return new Promise((resolve) => { finishItem = resolve; });
      if (entryId.endsWith("item-1") || entryId.endsWith("item-2")) return Promise.resolve(ready(entryId));
      return new Promise(() => {});
    });
    renderMusicCollection();
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(4), { timeout: 2_000 });
    await userEvent.click(screen.getByRole("button", { name: "Остановить" }));
    await userEvent.click(screen.getByRole("button", { name: "Редактировать теги: Видео 0:item-1" }));
    fireEvent.change(within(screen.getByRole("dialog", { name: "Метаданные" })).getByRole("textbox", { name: "Название" }), { target: { value: "Edited Song" } });
    await userEvent.click(screen.getByRole("button", { name: "Готово" }));
    if (clip) await userEvent.click(screen.getByRole("tab", { name: "Клип" }));
    const row = screen.getByRole("checkbox", { name: /Видео 5/ });
    fireEvent.keyDown(row, { key: " " });
    const analyze = within(row).getByRole("button", { name: "Проанализировать: Видео 5" });
    expect(analyze.closest(".playlist-status-cell")).not.toBeNull();
    expect(within(row.querySelector(".playlist-row-title")!).queryByRole("button", { name: /Проанализировать/ })).not.toBeInTheDocument();
    await userEvent.click(analyze);
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(5));
    const call = vi.mocked(api.probePlaylistItem).mock.calls[4];
    expect(call[0]).toBe("4:item-5");
    expect(call[3]).toMatch(/^music-playlist-item-/);
    const busy = within(row).getByRole("status", { name: "Анализируется" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy.closest(".playlist-status-cell")).not.toBeNull();
    expect(row.querySelectorAll(".analysis-spinner")).toHaveLength(1);
    expect(row.querySelector(".playlist-row-title .analysis-spinner")).toBeNull();
    expect(row).not.toHaveTextContent("Анализируется");
    expect(within(row).queryByRole("button", { name: /Проанализировать/ })).not.toBeInTheDocument();
    expect(row).toHaveAttribute("aria-checked", "false");
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(5);
    await act(async () => finishItem(ready("4:item-5")));
    expect(within(row).getByRole("button", { name: "Редактировать теги: Видео 4:item-5" })).toBeEnabled();
    expect(screen.getByText("Анализ: 3 из 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продолжить анализ" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Edited Song/ })).toHaveAttribute("aria-checked", "true");
    expect(row).toHaveAttribute("aria-checked", "false");
    expect(api.probePlaylistItem).toHaveBeenCalledTimes(5);
  });

  it("keeps an individual music probe active across bulk stop/resume and cancels it on URL change", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue({ ...playlistInfo(4), musicKind: "playlist" });
    let finishItem!: (result: PlaylistItemAnalysis) => void;
    const finishBulk: Array<() => void> = [];
    vi.mocked(api.probePlaylistItem).mockImplementation((entryId, _url, _cookies, session) => new Promise((resolve) => {
      if (session.startsWith("music-playlist-item-")) finishItem = resolve;
      else finishBulk.push(() => resolve(ready(entryId)));
    }));
    const view = renderMusicCollection();
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    await userEvent.click(screen.getByRole("button", { name: "Проанализировать: Видео 3" }));
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(3));
    const manualSession = vi.mocked(api.probePlaylistItem).mock.calls[2][3];
    await userEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(within(screen.getByRole("checkbox", { name: /Видео 3/ })).getByRole("status", { name: "Анализируется" })).toHaveAttribute("aria-busy", "true");
    expect(api.cancelPlaylistAnalysis).not.toHaveBeenCalledWith(manualSession);
    await act(async () => finishBulk.slice(0, 2).forEach((finish) => finish()));
    await userEvent.click(screen.getByRole("button", { name: "Продолжить анализ" }));
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(5));
    expect(vi.mocked(api.probePlaylistItem).mock.calls.slice(3).map((call) => call[0])).toEqual(["0:item-1", "1:item-2"]);
    expect(within(screen.getByRole("checkbox", { name: /Видео 3/ })).getByRole("status", { name: "Анализируется" })).toHaveAttribute("aria-busy", "true");
    expect(api.cancelPlaylistAnalysis).not.toHaveBeenCalledWith(manualSession);
    view.rerender(<I18nProvider locale="ru"><Playlist musicMode url="" sourceIsPlaylist={false} authSettings={authSettings} authenticated={false} includeVideoTechnicalDetailsInFilename={false} formatSelectionMode="strict" jobs={[]} downloadedHistoryKeys={new Set()} onUrlChange={vi.fn()} onJobsCreated={vi.fn()} onOpenQueue={vi.fn()} /></I18nProvider>);
    expect(api.cancelPlaylistAnalysis).toHaveBeenCalledWith(manualSession);
    await act(async () => finishItem(ready("2:item-3")));
    expect(screen.queryByText("Видео 2:item-3")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Редактировать теги/ })).not.toBeInTheDocument();
  });

  it("offers a retry after an individual probe rejects, using a new request without resuming bulk", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue({ ...playlistInfo(3), musicKind: "playlist" });
    let attempts = 0;
    vi.mocked(api.probePlaylistItem).mockImplementation((entryId, _url, _cookies, session) => {
      if (!session.startsWith("music-playlist-item-")) return new Promise(() => {});
      if (++attempts === 1) return Promise.reject(new Error("Connection interrupted"));
      return Promise.resolve(ready(entryId));
    });
    renderMusicCollection("en");
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await userEvent.click(screen.getByRole("button", { name: "Analyze item: Видео 3" }));
    const retry = await screen.findByRole("button", { name: "Analyze item: Видео 3" });
    expect(retry).toBeEnabled();
    expect(retry.closest(".playlist-status-cell")).not.toBeNull();
    expect(within(retry.closest(".playlist-table-row")! as HTMLElement).getByText("Temporary error")).toBeInTheDocument();
    await userEvent.click(retry);
    expect(await screen.findByRole("button", { name: "Edit tags: Видео 2:item-3" })).toBeEnabled();
    const calls = vi.mocked(api.probePlaylistItem).mock.calls.filter((call) => call[3].startsWith("music-playlist-item-"));
    expect(calls).toHaveLength(2);
    expect(calls[0][4]).not.toBe(calls[1][4]);
    expect(screen.getByRole("button", { name: "Resume analysis" })).toBeInTheDocument();
  });

  it("keeps the summary under the preview only when playlist parameters are alongside the list", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));
    renderPlaylist();

    await screen.findByText("Тестовый плейлист", {}, { timeout: 2_000 });
    const summary = screen.getByRole("region", { name: "Итоговая загрузка" });
    const list = screen.getByText("Тестовый плейлист").closest<HTMLElement>(".playlist-list-card")!;
    expect(within(list).getByRole("region", { name: "Итоговая загрузка" })).toBe(summary);
    expect(within(summary).queryByRole("heading", { name: "Итоговая загрузка" })).not.toBeInTheDocument();
    await waitFor(() => expect(within(summary).getByText("Видео: 1")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("tab", { name: "Аудио" }));
    expect(within(summary).getByText("Треков: 1")).toBeInTheDocument();
    fireEvent.change(within(summary).getByRole("textbox", { name: "Папка загрузки" }), { target: { value: "D:/Audio" } });

    await userEvent.click(screen.getByRole("button", { name: "Показать список сверху" }));
    const expandedSummary = screen.getByRole("region", { name: "Итоговая загрузка" });
    expect(within(expandedSummary).getByRole("heading", { name: "Итоговая загрузка" })).toBeInTheDocument();
    expect(within(expandedSummary).getByRole("textbox", { name: "Папка загрузки" })).toHaveValue("D:/Audio");
    expect(within(screen.getByText("Тестовый плейлист").closest<HTMLElement>(".playlist-list-card")!).queryByRole("region", { name: "Итоговая загрузка" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Скачать выбранные (1)" })).toHaveLength(1);
  });

  it.each(["ru", "en"] as const)("shows the music collection summary without a layout switch in %s", async (locale) => {
    vi.mocked(api.probePlaylist).mockResolvedValueOnce({ ...playlistInfo(2), musicKind: "playlist", totalDuration: 120 });
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));
    renderMusicCollection(locale);
    const available = locale === "ru" ? "Доступно" : "Available";
    await waitFor(() => expect(screen.getAllByText(available)).toHaveLength(2));
    const header = within(screen.getByText("Тестовый плейлист").closest(".playlist-header-card")!);
    expect(header.getByText(locale === "ru" ? "Различные исполнители" : "Various artists")).toBeInTheDocument();
    expect(header.getByText(locale === "ru" ? "Треков: 2 · 2:00" : "Tracks: 2 · 2:00")).toBeInTheDocument();
    expect(await header.findByText(locale === "ru" ? /Выбрано: 2 из 2,.*100 ГБ из 250 ГБ/ : /Selected: 2 of 2,.*100 GB free of 250 GB/)).toHaveTextContent(locale === "ru" ? "≈ 0,2 МБ" : "≈ 0.2 MB");
    expect(screen.getByText(locale === "ru" ? "Анализ: 2 из 2" : "Analysis: 2 of 2")).toBeInTheDocument();
    const summary = within(screen.getByRole("region", { name: locale === "ru" ? "Итоговая загрузка" : "Final download" }));
    expect(summary.getByText(locale === "ru" ? "Треков: 2" : "Tracks: 2")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: locale === "ru" ? "Скачать выбранные (2)" : "Download selected (2)" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: locale === "ru" ? /Показать список/ : /Show the list/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("checkbox", { name: /Видео 0:item-1/ }), { key: " " });
    expect(header.getByText(locale === "ru" ? /Выбрано: 1 из 2,/ : /Selected: 1 of 2,/)).toHaveTextContent(locale === "ru" ? "≈ 0,1 МБ" : "≈ 0.1 MB");
    expect(summary.getByText(locale === "ru" ? "Треков: 1" : "Tracks: 1")).toBeInTheDocument();
  });

  it("shows music columns, estimates and progressive analysis states in the shared table", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValueOnce({ ...playlistInfo(5), musicKind: "playlist" });
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => {
      if (entryId.endsWith("item-1")) return { entryId, state: "ready", media: { ...media(entryId), duration: 87, music: { title: "Ready Song", artist: "Artist, Guest", album: "Album", albumArtist: "Artist", year: "2025", trackNumber: null } } };
      if (entryId.endsWith("item-2")) return { entryId, state: "unavailable", media: null, issue: { code: "removedVideo", message: "Removed", retryable: false, requiresAuth: false } };
      return new Promise<PlaylistItemAnalysis>(() => {});
    });
    renderMusicCollection();
    const heading = await screen.findByText("Трек / Исполнитель");
    const table = within(heading.closest(".playlist-table-wrap")!);
    expect(table.getByText("Длит.")).toBeInTheDocument();
    expect(table.getByText("Размер")).toBeInTheDocument();
    expect(table.getByText("Статус")).toBeInTheDocument();
    const song = await table.findByRole("checkbox", { name: /Ready Song/ });
    expect(song).toHaveTextContent("Artist, Guest");
    expect(song).toHaveTextContent("1:27");
    expect(song).toHaveTextContent("≈ 0,1 МБ");
    expect(song).toHaveTextContent("Доступно");
    await waitFor(() => expect(table.getAllByRole("status", { name: "Анализируется" })).toHaveLength(2));
    expect(table.queryByText("Анализируется")).not.toBeInTheDocument();
    expect(table.getByText("Ожидает анализа")).toBeInTheDocument();
    expect(table.getByText("Недоступно")).toBeInTheDocument();
    expect(table.getByRole("checkbox", { name: /Видео 2/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Снять выбор со всех объектов" })).not.toBeInTheDocument();
    const titles = () => Array.from(document.querySelectorAll(".playlist-table-row .playlist-row-title strong"), (node) => node.textContent);
    await userEvent.click(table.getByRole("button", { name: "Статус: От лучших статусов к худшим" }));
    expect(titles()).toEqual(["Ready Song", "Видео 3", "Видео 4", "Видео 5", "Видео 2"]);
    await userEvent.click(table.getByRole("button", { name: "Статус: От худших статусов к лучшим" }));
    expect(titles()).toEqual(["Видео 2", "Видео 5", "Видео 3", "Видео 4", "Ready Song"]);
  });

  it("shows a mixed playlist header checkbox for partial selection", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValueOnce(playlistInfo(3));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => entryId.endsWith("item-3")
      ? { entryId, state: "unavailable", media: null, issue: { code: "removedVideo", message: "Removed", retryable: false, requiresAuth: false } }
      : ready(entryId));
    renderPlaylist();
    await waitFor(() => expect(screen.getAllByText("Доступно")).toHaveLength(2));
    await screen.findByText("Недоступно");
    const all = screen.getByRole("button", { name: "Снять выбор со всех объектов" });
    const indicator = all.querySelector(".playlist-checkbox");
    const rows = within(all.closest(".playlist-table-wrap")!).getAllByRole("checkbox");
    expect(indicator).toHaveAttribute("data-checked", "true");
    expect(indicator).not.toHaveAttribute("data-mixed");
    fireEvent.keyDown(rows[0], { key: " " });
    expect(indicator).toHaveAttribute("data-mixed", "true");
    expect(indicator).not.toHaveAttribute("data-checked");
    fireEvent.keyDown(rows[1], { key: " " });
    expect(indicator).not.toHaveAttribute("data-mixed");
    expect(indicator).not.toHaveAttribute("data-checked");
    await userEvent.click(all);
    expect(indicator).toHaveAttribute("data-checked", "true");
    expect(indicator).not.toHaveAttribute("data-mixed");
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
    expect(rows[1]).toHaveAttribute("aria-checked", "true");
    expect(rows[2]).toHaveAttribute("aria-checked", "false");
  });

  it("selects music using the header checkbox and represents partial selection", async () => {
    vi.mocked(api.probePlaylist).mockResolvedValueOnce({ ...playlistInfo(2), musicKind: "playlist" });
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));
    renderMusicCollection();
    await waitFor(() => expect(screen.getAllByText("Доступно")).toHaveLength(2));
    const all = screen.getByRole("checkbox", { name: "Выбрать все треки" });
    const rows = within(all.closest(".playlist-table-wrap")!).getAllByRole("checkbox").filter((item) => item !== all);
    expect(all).toHaveAttribute("aria-checked", "true");
    await userEvent.click(all);
    expect(all).toHaveAttribute("aria-checked", "false");
    rows.forEach((row) => expect(row).toHaveAttribute("aria-checked", "false"));
    fireEvent.keyDown(rows[0], { key: " " });
    expect(all).toHaveAttribute("aria-checked", "mixed");
    await userEvent.click(all);
    rows.forEach((row) => expect(row).toHaveAttribute("aria-checked", "true"));
    expect(all).toHaveAttribute("aria-checked", "true");
  });
  it("reloads a protected music collection after the YouTube session changes", async () => {
    vi.mocked(api.probePlaylist).mockRejectedValueOnce({ code: "authenticationRequired", message: "Sign in", retryable: true, requiresAuth: true }).mockResolvedValueOnce(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));
    const element = (authenticated: boolean) => <I18nProvider locale="ru"><Playlist musicMode audioEncoders={["aac", "libopus", "flac"]} url="https://music.youtube.com/playlist?list=LM" sourceIsPlaylist authSettings={{ ...authSettings, useYoutubeSession: authenticated }} authenticated={authenticated} includeVideoTechnicalDetailsInFilename={false} formatSelectionMode="strict" jobs={[]} downloadedHistoryKeys={new Set()} onUrlChange={vi.fn()} onJobsCreated={vi.fn()} onOpenQueue={vi.fn()} /></I18nProvider>;
    const view = render(element(false));
    await screen.findByText("Нужно войти в YouTube");
    view.rerender(element(true));
    await waitFor(() => expect(api.probePlaylist).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.probePlaylist).mock.calls[1][1]).toEqual({ kind: "youtubeSession" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Скачать выбранные (1)" })).toBeEnabled());
  });
  it("keeps repeated album entries independent and queues original positions with edited tags", async () => {
    const info = playlistInfo(2);
    info.id = "OLAK5uy_album";
    info.musicKind = "album";
    info.entries[1].id = info.entries[0].id;
    info.entries[1].index = 8;
    vi.mocked(api.probePlaylist).mockResolvedValueOnce(info);
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ({ entryId, state: "ready", media: { ...media(entryId), music: { title: entryId, artist: "Artist, Guest", album: "Album", albumArtist: "Artist", year: "2025", trackNumber: null } } }));
    render(<I18nProvider locale="ru"><Playlist musicMode audioEncoders={["aac", "libopus", "flac"]} url="https://music.youtube.com/playlist?list=OLAK5uy_album" sourceIsPlaylist authSettings={authSettings} authenticated={false} includeVideoTechnicalDetailsInFilename={false} formatSelectionMode="strict" jobs={[]} downloadedHistoryKeys={new Set()} onUrlChange={vi.fn()} onJobsCreated={vi.fn()} onOpenQueue={vi.fn()} /></I18nProvider>);
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: /скачать выбранные.*2/i })).toBeEnabled());
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("08")).toBeInTheDocument();
    const firstTrack = screen.getByRole("checkbox", { name: /0:item-1/ });
    expect(within(firstTrack).getByRole("img", { name: "0:item-1" })).toHaveAttribute("src", media("0:item-1").thumbnail);
    await userEvent.click(screen.getByRole("button", { name: "Редактировать теги: 0:item-1" }));
    fireEvent.change(within(screen.getByRole("dialog", { name: "Метаданные" })).getByRole("textbox", { name: "Название" }), { target: { value: "Edited Song" } });
    await userEvent.click(screen.getByRole("button", { name: "Готово" }));
    expect(screen.getByRole("checkbox", { name: /Edited Song/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByRole("textbox", { name: "Альбом" }), { target: { value: "Edited album" } });
    await userEvent.click(screen.getByRole("button", { name: "Изменить" }));
    expect(screen.getByRole("textbox", { name: "Папка загрузки" })).toHaveValue("D:/Video");
    await userEvent.click(screen.getByRole("button", { name: /скачать выбранные.*2/i }));
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalled());
    const items = vi.mocked(api.enqueueDownloadBatch).mock.calls[0][0];
    expect(items.map((item) => item.clientId)).toEqual(["0:item-1", "1:item-1"]);
    expect(items.map((item) => item.request.music?.metadata.trackNumber)).toEqual([1, 8]);
    expect(items[0].request.music?.metadata.title).toBe("Edited Song");
    expect(items[1].request.music?.metadata).toMatchObject({ album: "Edited album", artist: "Artist, Guest" });
    expect(items[0].request).toMatchObject({ destinationDir: "D:/Video", preset: "audioSource", audioBitrate: null, audioChannels: "source" });
  });
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

  it("retries limited and cancelled in-flight rows after 429", async () => {
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
    await waitFor(() => expect(api.probePlaylistItem).toHaveBeenCalledTimes(5));
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

  it.each(["playlist", "stacked", "music"])("keeps the download label and click animation stable while enqueueing %s", async (layout) => {
    vi.mocked(api.probePlaylist).mockResolvedValue(playlistInfo(1));
    vi.mocked(api.probePlaylistItem).mockImplementation(async (entryId) => ready(entryId));
    let finish!: (result: Awaited<ReturnType<typeof api.enqueueDownloadBatch>>) => void;
    vi.mocked(api.enqueueDownloadBatch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));

    if (layout === "music") renderMusicCollection(); else renderPlaylist();
    if (layout === "stacked") await userEvent.click(await screen.findByRole("button", { name: "Показать список сверху" }, { timeout: 2_000 }));
    const button = await screen.findByRole("button", { name: "Скачать выбранные (1)" }, { timeout: 2_000 });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveClass("download-action");
    expect(button).toHaveAttribute("data-analyzed", "true");
    expect(button.querySelector(".download-action-icon")).toBeInTheDocument();

    await userEvent.click(button);

    expect(button).toHaveAttribute("data-animating", "true");
    await waitFor(() => expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(1));
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Скачать выбранные (1)");
    await userEvent.click(button);
    expect(api.enqueueDownloadBatch).toHaveBeenCalledTimes(1);
    await act(async () => finish({ queued: [], rejected: [] }));
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toHaveTextContent("Скачать выбранные (1)");
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
