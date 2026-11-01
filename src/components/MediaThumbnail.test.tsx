import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MediaThumbnail, thumbnailCandidates } from "./MediaThumbnail";

describe("MediaThumbnail", () => {
  it("opens a cover without toggling its row and closes with Escape or the close button", async () => {
    let toggles = 0;
    render(<div onClick={() => toggles++}><MediaThumbnail zoomable src="https://example.com/cover.jpg" alt="Album"
      className="thumbnail" placeholderClassName="placeholder" /></div>);
    const trigger = screen.getByRole("button", { name: "Рассмотреть обложку: Album" });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Обложка" });
    expect(within(dialog).getByAltText("Album")).toHaveAttribute("src", "https://example.com/cover.jpg");
    expect(screen.getByRole("button", { name: "Закрыть обложку" })).toHaveFocus();
    expect(toggles).toBe(0);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "Закрыть обложку" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toggles).toBe(0);
  });
  it("derives stable YouTube preview fallbacks from a media URL", () => {
    expect(thumbnailCandidates(null, "https://www.youtube.com/watch?v=abc123")).toEqual([
      "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      "https://i.ytimg.com/vi/abc123/mqdefault.jpg",
    ]);
  });

  it("moves to a YouTube fallback when the supplied preview fails", () => {
    render(
      <MediaThumbnail
        src="https://example.com/unavailable.webp"
        mediaUrl="https://youtu.be/abc123"
        alt="Preview"
        className="thumbnail"
        placeholderClassName="placeholder"
      />,
    );

    const image = screen.getByAltText("Preview");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "https://i.ytimg.com/vi/abc123/hqdefault.jpg");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  });
});
