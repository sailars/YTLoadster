import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import type { HistoryItem } from "../lib/types";
import { History } from "./History";

const item: HistoryItem = {
  id: "history-1",
  url: "https://youtu.be/history-1",
  canonicalSource: "https://youtube.com/watch?v=history-1",
  title: "Историческое видео",
  outputPath: "D:/Video/history-1.mp4",
  preset: "mp4Video",
  formatLabel: "MP4 1080p H.264 + AAC",
  fileSizeBytes: 48 * 1024,
  completedAtMs: Date.UTC(2026, 7, 20, 12, 30),
};

function renderHistory(overrides: Partial<Parameters<typeof History>[0]> = {}) {
  const props = {
    items: [item],
    onOpenFolder: vi.fn(),
    onRepeat: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<I18nProvider locale="ru"><History {...props} /></I18nProvider>);
  return props;
}

describe("History", () => {
  it("searches titles and saved artists without changing history actions or the total", async () => {
    const song: HistoryItem = { ...item, id: "song", title: "Новый трек", request: {
      url: item.url, preset: "audioMp3", destinationDir: "Music", music: {
        metadata: { title: "Новый трек", artist: "Алёна", albumArtist: "Алёна", album: "", year: "", trackNumber: null },
        collectionKind: "single", collectionTitle: null, sourceCodec: null,
      },
    } };
    const props = renderHistory({ items: [item, song] });
    const search = screen.getByRole("searchbox", { name: "Поиск по названию и исполнителю" });
    await userEvent.type(search, "АЛЕНА новый");
    expect(screen.getByText("Новый трек")).toBeInTheDocument();
    expect(screen.queryByText("Историческое видео")).not.toBeInTheDocument();
    expect(screen.getByText("1 из 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Записей в истории: 2")).toHaveTextContent("2");
    await userEvent.click(screen.getByRole("button", { name: "Повторить Новый трек" }));
    expect(props.onRepeat).toHaveBeenCalledWith(song);
    await userEvent.clear(search);
    await userEvent.type(search, "нет совпадений");
    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("Историческое видео")).toBeInTheDocument();
    await userEvent.type(search, "новый");
    await userEvent.click(screen.getByRole("button", { name: "Очистить поиск" }));
    expect(search).toHaveFocus();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(props.onRemove).not.toHaveBeenCalled();
    await userEvent.type(search, "новый");
    await userEvent.click(screen.getByRole("button", { name: "Очистить историю" }));
    expect(screen.getByRole("dialog", { name: "Очистить всю историю?" })).toBeInTheDocument();
  });

  it("opens the folder from an exact legacy output path when no destination is stored", async () => {
    const props = renderHistory();

    expect(screen.getByLabelText("Записей в истории: 1")).toHaveTextContent("1");
    expect(screen.queryByText("Успешно созданные файлы")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Открыть папку для Историческое видео" }));

    expect(props.onOpenFolder).toHaveBeenCalledWith("D:/Video/history-1.mp4");
    expect(screen.getByText("48 КБ")).toBeInTheDocument();
    expect(screen.getByRole("time")).toHaveAttribute("datetime", "2026-08-20T12:30:00.000Z");
  });

  it("confirms that clearing records does not remove downloaded files", async () => {
    const onClear = vi.fn().mockResolvedValue(undefined);
    renderHistory({ onClear });

    await userEvent.click(screen.getByRole("button", { name: "Очистить историю" }));
    const dialog = screen.getByRole("dialog", { name: "Очистить всю историю?" });
    expect(dialog).toHaveTextContent("Загруженные файлы останутся на диске");
    await userEvent.click(within(dialog).getByRole("button", { name: "Очистить историю" }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
