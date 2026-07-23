import { describe, expect, it } from "vitest";
import { disableDefaultContextMenu } from "./contextMenu";

describe("disableDefaultContextMenu", () => {
  it("prevents the default WebView context menu", () => {
    const cleanup = disableDefaultContextMenu(document);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });
});
