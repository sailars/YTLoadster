import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Downloader } from "../Downloader";
import { I18nProvider } from "../../lib/i18n";
import { api } from "../../lib/api";
import type { DownloadRequest, Job, MediaInfo } from "../../lib/types";
import type { SingleWorkspace } from "../../lib/workspace";

vi.mock("../../lib/api", () => ({ api: {
  probeUrl: vi.fn(), cancelUrlAnalysis: vi.fn().mockResolvedValue(undefined),
  checkHistoryDuplicates: vi.fn().mockResolvedValue([]), enqueueDownload: vi.fn().mockResolvedValue({ id: 1 } as Job),
} }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: vi.fn(), writeText: vi.fn() }));

const media: MediaInfo = {
  title: "Source title", webpageUrl: "https://music.youtube.com/watch?v=song", duration: 180,
  music: { title: "Song", artist: "Artist, Guest", album: "Album", albumArtist: "Artist", year: "2025", trackNumber: 7 },
  videoFormats: [], audioFormats: [
    { kind: "audio", formatId: "140", qualityLabel: "128 kbps", codec: "AAC", ext: "m4a", bitrateKbps: 128 },
    { kind: "audio", formatId: "251", qualityLabel: "160 kbps", codec: "OPUS", ext: "webm", bitrateKbps: 160 },
  ],
};
function form(request?: DownloadRequest, locale: "ru" | "en" = "ru", musicMode = true, onOpenQueue = () => {}, settingsResetVersion = 0, initialWorkspace?: SingleWorkspace) {
  return <I18nProvider locale={locale}><Downloader musicMode={musicMode} audioEncoders={["aac", "libmp3lame", "libopus", "flac"]}
    settingsResetVersion={settingsResetVersion}
    initialWorkspace={initialWorkspace}
    url={media.webpageUrl!} sourceIsVideo defaultDestinationDir="downloads" includeVideoTechnicalDetailsInFilename={false}
    authSettings={{ useBrowserCookies: false, useYoutubeSession: false, browser: "chrome" }}
    repeatDraft={request ? { id: "repeat", request } : null} onRepeatConsumed={() => {}} onUrlChange={() => {}}
    onOpenQueue={onOpenQueue} onJobCreated={() => {}} /></I18nProvider>;
}
async function download() {
  const button = screen.getByRole("button", { name: "Скачать выбранные (1)" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(api.enqueueDownload).toHaveBeenCalled());
  return vi.mocked(api.enqueueDownload).mock.calls[0][0];
}

describe("YouTube Music single download", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.probeUrl).mockResolvedValue(media); });
  it.each([false, true])("keeps restored single-track metadata in StrictMode, cached=%s", async (cached) => {
    const saved: SingleWorkspace = {
      kind: "single", url: media.webpageUrl!, media: cached ? media : null, mode: "audio", preset: "audioMp3",
      destinationDir: "saved-folder", videoProfile: "best", selectedVideoFormatId: null, selectedAudioFormatId: cached ? "251" : null,
      selectedSubtitleKey: null, selectedSubtitleFormat: null, audioBitrate: "192K", audioChannels: "stereo",
      embedMetadata: true, embedThumbnail: false, musicQuality: "best", musicEdits: { title: "Saved song" },
    };
    render(<StrictMode>{form(undefined, "ru", true, () => {}, 0, saved)}</StrictMode>);
    expect(await screen.findByDisplayValue("Saved song")).toBeInTheDocument();
    const request = await download();
    expect(request.music?.metadata.title).toBe("Saved song");
    expect(request.audioBitrate).toBe("192K");
    expect(request.destinationDir).toBe("saved-folder");
    expect(api.probeUrl).toHaveBeenCalledTimes(cached ? 0 : 1);
  });
  it("restores download defaults on settings reset while retaining edited track metadata", async () => {
    const view = render(form());
    const title = await screen.findByDisplayValue("Song");
    fireEvent.change(title, { target: { value: "Edited song" } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Встраивать метаданные" }));
    expect(screen.getByRole("checkbox", { name: "Встраивать метаданные" })).not.toBeChecked();
    view.rerender(form(undefined, "ru", true, () => {}, 1));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Встраивать метаданные" })).toBeChecked());
    const request = await download();
    expect(request.preset).toBe("audioSource");
    expect(request.embedMetadata).toBe(true);
    expect(request.embedThumbnail).toBe(true);
    expect(request.destinationDir).toBe("downloads");
    expect(request.music?.metadata.title).toBe("Edited song");
  });
  it.each(["ru", "en"] as const)("shows the single-track confirmation below its action with countdown and queue link in %s", async (locale) => {
    const openQueue = vi.fn();
    render(form(undefined, locale, true, openQueue));
    const action = await screen.findByRole("button", { name: locale === "ru" ? "Скачать выбранные (1)" : "Download selected (1)" });
    await waitFor(() => expect(action).toBeEnabled());
    await userEvent.click(action);
    const summary = screen.getByRole("region", { name: locale === "ru" ? "Итоговая загрузка" : "Final download" });
    const notice = await within(summary).findByRole("status");
    expect(notice).toHaveTextContent(locale === "ru" ? "Аудио добавлено в очередь" : "Audio added to the queue");
    expect(action.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.querySelector(".notice-countdown")).toBeInTheDocument();
    expect(document.querySelectorAll(".single-enqueue-result")).toHaveLength(1);
    await userEvent.click(within(notice).getByRole("button", { name: locale === "ru" ? "Открыть Очередь" : "Open Queue" }));
    expect(openQueue).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("keeps the action label stable while enqueueing, music=%s", async (musicMode) => {
    let finish!: (job: Job) => void;
    vi.mocked(api.enqueueDownload).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(form(undefined, "ru", musicMode));
    if (!musicMode) await userEvent.click(await screen.findByRole("tab", { name: "Аудио" }));
    const button = await screen.findByRole("button", { name: musicMode ? "Скачать выбранные (1)" : "Скачать аудио" });
    await waitFor(() => expect(button).toBeEnabled());
    const label = button.textContent;
    await userEvent.click(button);
    await waitFor(() => expect(api.enqueueDownload).toHaveBeenCalledTimes(1));
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(button.textContent).toBe(label);
    await userEvent.click(button);
    expect(api.enqueueDownload).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: 1 } as Job));
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button.textContent).toBe(label);
  });
  it("enqueues original audio with edited tags and the selected source quality", async () => {
    render(form());
    await screen.findByDisplayValue("Song");
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Edited Song" } });
    fireEvent.change(screen.getByLabelText("Папка загрузки"), { target: { value: "music-output" } });
    await userEvent.click(screen.getByRole("combobox", { name: "Качество источника" }));
    await userEvent.click(screen.getByRole("option", { name: "До 128 kbps" }));
    const request = await download();
    expect(request).toMatchObject({ destinationDir: "music-output", preset: "audioSource", formatId: "140", audioBitrate: null,
      music: { sourceQuality: "128", collectionKind: "single", metadata: { title: "Edited Song", artist: "Artist, Guest" } } });
  });
  it.each([undefined, true, false])("restores source quality, album folder and original position from History, folder=%s", async (createAlbumFolder) => {
    render(form({ url: media.webpageUrl!, destinationDir: "downloads", preset: "audioSource", embedMetadata: true,
      music: { collectionKind: "album", collectionTitle: "Edited Album", sourceCodec: "AAC", sourceQuality: "128", createAlbumFolder,
        metadata: { ...media.music!, album: "Edited Album", title: "Saved title" } } }));
    await screen.findByDisplayValue("Saved title");
    const request = await download();
    expect(request).toMatchObject({ formatId: "140", music: { sourceQuality: "128", collectionKind: "album", collectionTitle: "Edited Album", createAlbumFolder: createAlbumFolder ?? true, metadata: { title: "Saved title", trackNumber: 7 } } });
  });
  it("keeps edited tags after changing the UI language", async () => {
    const view = render(form());
    await screen.findByDisplayValue("Song");
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Edited Song" } });
    view.rerender(form(undefined, "en"));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Edited Song"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Download selected (1)" })).toBeEnabled());
  });
  it("disables downloading a clip when the supplied entry has no video stream", async () => {
    render(form());
    await screen.findByDisplayValue("Song");
    await userEvent.click(screen.getByRole("tab", { name: "Клип" }));
    expect(screen.getByRole("button", { name: "Скачать выбранные (1)" })).toBeDisabled();
    expect(api.enqueueDownload).not.toHaveBeenCalled();
  });
  it.each([false, true])("requires separate or embedded audio for a clip, embedded=%s", async (hasAudio) => {
    vi.mocked(api.probeUrl).mockResolvedValue({ ...media, audioFormats: [], videoFormats: [{ kind: "video", formatId: "18", qualityLabel: "360p MP4", ext: "mp4", height: 360, hasAudio }] });
    render(form());
    await screen.findByDisplayValue("Song");
    await userEvent.click(screen.getByRole("tab", { name: "Клип" }));
    const action = screen.getByRole("button", { name: "Скачать выбранные (1)" });
    if (!hasAudio) {
      expect(action).toBeDisabled();
      expect(screen.getByText("Видео со звуком недоступно для этой записи.")).toBeInTheDocument();
    } else {
      await waitFor(() => expect(action).toBeEnabled());
      await userEvent.click(action);
      await waitFor(() => expect(api.enqueueDownload).toHaveBeenCalledWith(expect.objectContaining({ formatId: "18", preset: "bestVideo" })));
      expect(await within(screen.getByRole("region", { name: "Итоговая загрузка" })).findByText("Видео добавлено в очередь")).toBeInTheDocument();
    }
  });
});
