import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { DownloadSummaryCard } from "./DownloadSummaryCard";
import "../../styles.css";

describe("DownloadSummaryCard", () => {
  it("wraps a long final format instead of truncating it", () => {
    render(
      <I18nProvider locale="ru">
        <DownloadSummaryCard
          facts={[{ label: "Формат", value: "MKV (H.264 + Opus с длинным описанием формата)" }]}
          destinationDir="C:/Downloads"
          onDestinationChange={vi.fn()}
          onBrowse={vi.fn()}
          buttonAriaLabel="Скачать видео"
          disabled={false}
          busy={false}
          analyzed
        />
      </I18nProvider>,
    );

    const format = screen.getByText("MKV (H.264 + Opus с длинным описанием формата)");
    expect(format).toHaveClass("summary-fact-value");
  });

  it("renders the animated impact tray and burst particles", () => {
    render(
      <I18nProvider locale="ru">
        <DownloadSummaryCard
          facts={[]}
          destinationDir="C:/Downloads"
          onDestinationChange={vi.fn()}
          onBrowse={vi.fn()}
          buttonAriaLabel="Скачать видео"
          disabled={false}
          busy={false}
          analyzed
        />
      </I18nProvider>,
    );

    const button = screen.getByRole("button", { name: "Скачать видео" });
    expect(button.querySelector(".download-action-tray-flat")).toBeInTheDocument();
    expect(button.querySelector(".download-action-tray-bend")).toBeInTheDocument();
    expect(button.querySelectorAll(".download-action-particle")).toHaveLength(5);
  });
});
