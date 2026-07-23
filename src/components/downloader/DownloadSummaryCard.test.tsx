import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { DownloadSummaryCard } from "./DownloadSummaryCard";

describe("DownloadSummaryCard", () => {
  it("shows the localized label and starts the reference click animation", async () => {
    render(
      <I18nProvider locale="ru">
        <DownloadSummaryCard
          facts={[{ label: "Формат", value: "MP4" }]}
          destinationDir="C:\\Downloads"
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
    expect(button).toHaveTextContent("Скачать");
    expect(button).toHaveAttribute("data-analyzed", "true");

    await userEvent.click(button);

    expect(button).toHaveAttribute("data-animating", "true");
    expect(button.querySelector(".download-action-icon")).toBeInTheDocument();
  });

  it("keeps the English Download label", () => {
    render(
      <I18nProvider locale="en">
        <DownloadSummaryCard
          facts={[{ label: "Format", value: "MP4" }]}
          destinationDir="C:\\Downloads"
          onDestinationChange={vi.fn()}
          onBrowse={vi.fn()}
          buttonAriaLabel="Download video"
          disabled={false}
          busy={false}
          analyzed
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Download video" })).toHaveTextContent("Download");
  });
});
