import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { showDownloadCompletedNotification, showNotificationsEnabledNotification } from "./notifications";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(isPermissionGranted).mockResolvedValue(true);
});

it("passes native sound through IPC for a completed download", async () => {
  expect(await showDownloadCompletedNotification("Example", "ru")).toBe(true);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("show_system_notification", {
    title: "Загрузка завершена",
    body: expect.stringContaining("Example"),
    sound: true,
  });
});

it("keeps the notification enabling confirmation silent through IPC", async () => {
  expect(await showNotificationsEnabledNotification("en")).toBe(true);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("show_system_notification", {
    title: expect.any(String),
    body: expect.any(String),
    sound: false,
  });
});
