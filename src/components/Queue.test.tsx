import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import type { Job, JobState } from "../lib/types";
import { Queue } from "./Queue";
import "../styles.css";

function job(id: number, state: JobState, title: string): Job {
  return {
    id,
    state,
    request: {
      url: `https://youtube.com/watch?v=${id}`,
      title,
      preset: "bestVideo",
      destinationDir: "C:/Downloads",
    },
  };
}

function queueElement(jobs: Job[], locale: "ru" | "en" = "ru") {
  return (
    <I18nProvider locale={locale}>
      <Queue
        jobs={jobs}
        onCancel={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onPauseAll={vi.fn()}
        onResumeAll={vi.fn()}
        onCancelAll={vi.fn()}
        onClear={vi.fn()}
        onRemove={vi.fn()}
        onOpenFolder={vi.fn()}
        onRetry={vi.fn()}
      />
    </I18nProvider>
  );
}

function renderQueue(jobs: Job[], locale: "ru" | "en" = "ru") {
  return render(queueElement(jobs, locale));
}

describe("Queue status layout", () => {
  it.each(["ru", "en"] as const)("shows connection recovery below progress with the supplied attempt limit in %s", async (locale) => {
    const running: Job = { ...job(1, "Running", "Audio title"), phase: "DownloadingAudio", progressPercent: 45, speed: "18 MB/s", eta: "00:20", connectionRetry: { attempt: 2, limit: 7 } };
    const view = renderQueue([running], locale);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(locale === "ru" ? "Восстанавливаем соединение. Попытка: 2/7" : "Reconnecting. Attempt: 2/7");
    expect(screen.getByText(locale === "ru" ? "Нет соединения" : "No connection")).toHaveClass("queue-state-badge");
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.queryByText("18 MB/s")).not.toBeInTheDocument();
    expect(screen.queryByText(/00:20/)).not.toBeInTheDocument();
    const progress = document.querySelector(".progress-track")!;
    expect(progress.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: locale === "ru" ? "Пауза Audio title" : "Pause Audio title" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: locale === "ru" ? "Загружается · 1" : "Downloading · 1" }));
    expect(screen.getByRole("status")).toBe(notice);
    view.rerender(queueElement([{ ...running, connectionRetry: null, speed: "1 MB/s", eta: "00:15" }], locale));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("1 MB/s")).toBeInTheDocument();
    view.rerender(queueElement([{ ...running, state: "Failed", error: "network failed" }], locale));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(locale === "ru" ? "Нет соединения" : "No connection")).not.toBeInTheDocument();
  });

  it("explains why a queued download cannot refresh its live YouTube session", () => {
    renderQueue([{ ...job(1, "Failed", "Account video"), error: "youtube-auth-refresh-failed" }]);
    expect(screen.getByText(/не удалось обновить сессию YouTube/i)).toBeInTheDocument();
    expect(screen.queryByText("youtube-auth-refresh-failed")).not.toBeInTheDocument();
  });
  it("groups visible jobs, exposes filters and omits completed rows", async () => {
    renderQueue([
      job(1, "Running", "Running title"),
      job(2, "Pending", "Pending title"),
      job(3, "Paused", "Paused title"),
      job(4, "Failed", "Failed title"),
      job(5, "Cancelled", "Cancelled title"),
      job(6, "Completed", "Completed title"),
    ]);

    expect(screen.getByLabelText("Активных заданий: 3")).toHaveTextContent("3");
    expect(screen.getByRole("heading", { name: "Загружается · 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ожидает · 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Пауза · 1" })).toBeInTheDocument();
    expect(screen.queryByText("Completed title")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ошибка · 1" }));

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Failed title")).toBeInTheDocument();
    expect(screen.queryByText("Running title")).not.toBeInTheDocument();
  });

  it("shows the current running stage as a semantic status badge", () => {
    const running = {
      ...job(1, "Running", "Video title"),
      phase: "DownloadingVideo" as const,
      progressPercent: 47,
      speed: "18.4 MB/s",
      eta: "0:42",
    };
    renderQueue([running]);

    const status = screen.getByText("Скачивание видео…");
    expect(status).toHaveClass("queue-state-badge", "state-running");
    expect(screen.getByText("47%")).toBeInTheDocument();
    expect(screen.getByText("18.4 MB/s")).toBeInTheDocument();
    expect(screen.getByText("осталось 0:42")).toBeInTheDocument();
  });
});
