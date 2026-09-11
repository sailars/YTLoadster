import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MediaThumbnail, thumbnailCandidates } from "./MediaThumbnail";

describe("MediaThumbnail", () => {
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
